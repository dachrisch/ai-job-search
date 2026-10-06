// Thin HTTP client for the shared opencode instance (code.lehel.xyz).
// Same contract the dontforget project uses, verified live against the API:
//   POST /api/session            -> {"data": {"id": "ses_...", ...}}
//   POST /api/session/:id/prompt -> {"data": {...}} (an ack, not the reply)
//   GET  /api/session/:id/message -> {"data": [<newest message first>, ...]}
// The reply has to be polled for: keep GETting .../message until the newest
// entry is an assistant message with `finish` set (or `finish: "error"`).

const POLL_INTERVAL_MS = 1000
// Agent-mode models on opencode routinely spend 60-90s reasoning before their
// first text token — a tight timeout abandons a session opencode keeps
// computing to completion, then burns another one on retry.
const POLL_TIMEOUT_MS = 120_000
const MAX_ATTEMPTS = 3
const DEFAULT_RETRY_DELAY_MS = 1000

// Model discovery mirrors devhub (src/lib/opencode.ts): the registry at
// GET /api/model is the truth for which models are servable. A deprecated or
// disabled model fails server-side AFTER the prompt is admitted, so it must
// never be tried (that is how `mimo-v2.5-free` silently died).
const MODELS_TTL_MS = 10 * 60 * 1000
// A failed discovery only suppresses re-probing briefly and never replaces a
// previously good list.
const MODELS_FAILURE_TTL_MS = 30 * 1000
// A model that answered with a quota/rate-limit error is skipped this long.
const EXHAUSTED_COOLDOWN_MS = 15 * 60 * 1000

// Preferred free models, best first (verified active in the registry 2026-10-06).
// Other active cost-0 `opencode` models discovered at runtime follow these.
const FREE_PREFERENCE = [
  'mimo-v2.6-flash-free',
  'big-pickle',
  'nemotron-3.5-lightning-free',
  'nemotron-3-ultra-free',
  'ling-3.1-flash-free',
]
// Paid last resort once every free model is exhausted. Overridable via
// OPENCODE_PAID_MODEL ("provider:id").
const DEFAULT_PAID_MODEL: OpenCodeModel = { providerID: 'opencode-go', id: 'deepseek-v4.1-flash' }

const QUOTA_ERROR = /\b429\b|FreeUsageLimitError|rate limit|quota/i

interface OpencodeMessage {
  type: 'user' | 'assistant'
  finish?: string
  content?: Array<{ type: string; text?: string }>
  error?: { message: string }
}

export interface OpenCodeModel {
  id: string
  providerID: string
}

interface RegistryModel extends OpenCodeModel {
  status?: string
  enabled?: boolean
  cost?: Array<{ input?: number; output?: number }>
}

let lastGoodModels: RegistryModel[] | null = null
let lastGoodAtMs = 0
let lastFailureAtMs = 0
const exhaustedUntil = new Map<string, number>()

/** Clears discovery cache and quota cooldowns (tests only). */
export function resetOpencodeStateForTests(): void {
  lastGoodModels = null
  lastGoodAtMs = 0
  lastFailureAtMs = 0
  exhaustedUntil.clear()
}

export function getOpenCodeBaseUrl(): string {
  return process.env.OPENCODE_BASE_URL || 'http://code.lehel.xyz'
}

function getApiKey(): string {
  const key = process.env.OPENCODE_API_KEY
  if (!key) {
    throw new Error('OPENCODE_API_KEY not configured')
  }
  return key
}

function retryDelayMs(): number {
  const fromEnv = Number(process.env.OPENCODE_RETRY_DELAY_MS)
  return Number.isFinite(fromEnv) && process.env.OPENCODE_RETRY_DELAY_MS !== undefined ? fromEnv : DEFAULT_RETRY_DELAY_MS
}

function modelKey(model: OpenCodeModel): string {
  return `${model.providerID}:${model.id}`
}

function parseModelKey(value: string): OpenCodeModel | null {
  const [providerID, ...rest] = value.trim().split(':')
  const id = rest.join(':')
  return providerID && id ? { providerID, id } : null
}

function isUsable(model: RegistryModel): boolean {
  return (model.status === undefined || model.status === 'active') && model.enabled !== false
}

function isFree(model: RegistryModel): boolean {
  return Array.isArray(model.cost) && model.cost.length > 0 && model.cost.every(c => !c.input && !c.output)
}

async function discoverModels(): Promise<RegistryModel[] | null> {
  try {
    const response = await fetch(`${getOpenCodeBaseUrl()}/api/model`, {
      headers: { 'X-Api-Key': getApiKey() },
    })
    if (!response.ok) return null
    const json = (await response.json()) as unknown
    const list = Array.isArray(json)
      ? json
      : Array.isArray((json as any)?.data)
        ? (json as any).data
        : Array.isArray((json as any)?.models)
          ? (json as any).models
          : null
    if (!list || list.length === 0) return null
    return list
      .filter((m: any) => m?.id && m?.providerID)
      .map((m: any) => ({
        id: String(m.id),
        providerID: String(m.providerID),
        status: typeof m.status === 'string' ? m.status : undefined,
        enabled: typeof m.enabled === 'boolean' ? m.enabled : undefined,
        cost: Array.isArray(m.cost) ? m.cost : undefined,
      }))
  } catch {
    return null
  }
}

/** The server registry, cached; null when discovery is unavailable. Never throws. */
async function getRegistry(): Promise<RegistryModel[] | null> {
  const now = Date.now()
  if (lastGoodModels && now - lastGoodAtMs < MODELS_TTL_MS) return lastGoodModels
  if (lastFailureAtMs && now - lastFailureAtMs < MODELS_FAILURE_TTL_MS) return lastGoodModels
  const discovered = await discoverModels()
  if (discovered) {
    lastGoodModels = discovered
    lastGoodAtMs = now
    return discovered
  }
  lastFailureAtMs = now
  if (!lastGoodModels) console.warn('[opencode] model discovery unavailable — using the pinned model chain')
  return lastGoodModels
}

function preferenceRank(id: string): number {
  const index = FREE_PREFERENCE.indexOf(id)
  return index === -1 ? FREE_PREFERENCE.length : index
}

function paidModel(): OpenCodeModel {
  return (process.env.OPENCODE_PAID_MODEL && parseModelKey(process.env.OPENCODE_PAID_MODEL)) || DEFAULT_PAID_MODEL
}

/**
 * Free models first (env override, else discovered active cost-0 `opencode`
 * models in preference order, else the pinned list), then the paid model.
 * Models the registry marks unservable are dropped; quota-exhausted models are
 * skipped while their cooldown lasts.
 */
async function getModelChain(): Promise<OpenCodeModel[]> {
  const registry = await getRegistry()
  const usable = registry ? new Set(registry.filter(isUsable).map(modelKey)) : null
  const servable = (m: OpenCodeModel) => !usable || usable.has(modelKey(m))

  const override = (process.env.OPENCODE_MODELS || '')
    .split(',')
    .map(parseModelKey)
    .filter((m): m is OpenCodeModel => m !== null)

  let free: OpenCodeModel[]
  if (override.length > 0) {
    free = override.filter(servable)
  } else if (registry) {
    free = registry
      .filter(m => m.providerID === 'opencode' && isUsable(m) && isFree(m))
      .map((m, order) => ({ m, order }))
      .sort((a, b) => preferenceRank(a.m.id) - preferenceRank(b.m.id) || a.order - b.order)
      .map(({ m }) => ({ id: m.id, providerID: m.providerID }))
  } else {
    free = FREE_PREFERENCE.map(id => ({ id, providerID: 'opencode' }))
  }

  const chain = [...free]
  const paid = paidModel()
  if (servable(paid) && !chain.some(m => modelKey(m) === modelKey(paid))) chain.push(paid)

  const now = Date.now()
  const available = chain.filter(m => (exhaustedUntil.get(modelKey(m)) ?? 0) <= now)
  // Everything on cooldown: try the full chain rather than fail without asking.
  return available.length > 0 ? available : chain
}

/**
 * Runs a prompt against the opencode instance and returns the assistant's
 * text reply. Walks the model chain: transient failures are retried with
 * backoff; a quota/rate-limit error moves straight to the next model and puts
 * the exhausted one on cooldown. Throws on failure.
 */
export async function callOpencode(prompt: string): Promise<string> {
  getApiKey() // fail fast before discovery when the key is missing
  const models = await getModelChain()
  const paidKey = modelKey(paidModel())
  let lastError: unknown
  for (const model of models) {
    const key = modelKey(model)
    if (key === paidKey) console.warn(`[opencode] free models exhausted — falling back to paid ${key}`)
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const sessionId = await createSession(model)
        await sendPrompt(sessionId, prompt)
        const reply = await pollForReply(sessionId)
        console.log(`[opencode] answered by ${key}`)
        return reply
      } catch (err) {
        lastError = err
        const message = err instanceof Error ? err.message : String(err)
        if (QUOTA_ERROR.test(message)) {
          exhaustedUntil.set(key, Date.now() + EXHAUSTED_COOLDOWN_MS)
          console.warn(`[opencode] ${key} quota exhausted — skipping for ${EXHAUSTED_COOLDOWN_MS / 60000} min`)
          break
        }
        if (attempt < MAX_ATTEMPTS) {
          await sleep(retryDelayMs() * 2 ** (attempt - 1))
        }
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

async function createSession(model: OpenCodeModel): Promise<string> {
  const response = await fetch(`${getOpenCodeBaseUrl()}/api/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': getApiKey() },
    body: JSON.stringify({ model }),
  })
  if (!response.ok) {
    throw new Error(`opencode session create failed: ${response.status}`)
  }
  const data = (await response.json()) as { data: { id: string } }
  return data.data.id
}

async function sendPrompt(sessionId: string, text: string): Promise<void> {
  const response = await fetch(`${getOpenCodeBaseUrl()}/api/session/${sessionId}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': getApiKey() },
    body: JSON.stringify({ prompt: { text } }),
  })
  if (!response.ok) {
    throw new Error(`opencode prompt failed: ${response.status}`)
  }
}

async function pollForReply(sessionId: string): Promise<string> {
  const deadline = Date.now() + POLL_TIMEOUT_MS

  while (Date.now() < deadline) {
    const response = await fetch(`${getOpenCodeBaseUrl()}/api/session/${sessionId}/message`, {
      headers: { 'X-Api-Key': getApiKey() },
    })
    if (!response.ok) {
      throw new Error(`opencode message poll failed: ${response.status}`)
    }
    const data = (await response.json()) as { data: OpencodeMessage[] }
    const latest = data.data[0]

    if (latest?.type === 'assistant' && latest.finish) {
      if (latest.finish === 'error') {
        throw new Error(`opencode generation failed: ${latest.error?.message ?? 'unknown error'}`)
      }
      const textPart = latest.content?.find(p => p.type === 'text' && p.text)
      if (!textPart?.text) {
        throw new Error('opencode reply had no text content')
      }
      return textPart.text
    }

    await sleep(POLL_INTERVAL_MS)
  }

  throw new Error('opencode reply timed out')
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Extracts the first balanced JSON value (object or array) from a reply,
 * string-aware, so trailing prose or the literal example JSON inside the
 * prompt itself never breaks parsing. Throws if none is found.
 */
export function extractFirstJsonValue(text: string): string {
  const objectStart = text.indexOf('{')
  const arrayStart = text.indexOf('[')
  const start =
    objectStart === -1
      ? arrayStart
      : arrayStart === -1
        ? objectStart
        : Math.min(objectStart, arrayStart)

  if (start === -1) {
    throw new Error('opencode reply did not contain JSON')
  }

  const open = text[start]
  const close = open === '{' ? '}' : ']'

  let depth = 0
  let inString = false
  let escapeNext = false

  for (let i = start; i < text.length; i++) {
    const char = text[i]

    if (escapeNext) {
      escapeNext = false
      continue
    }
    if (char === '\\') {
      escapeNext = true
      continue
    }
    if (char === '"') {
      inString = !inString
      continue
    }
    if (inString) continue

    if (char === open) {
      depth++
    } else if (char === close) {
      depth--
      if (depth === 0) {
        return text.slice(start, i + 1)
      }
    }
  }

  throw new Error('opencode reply contained an unterminated JSON value')
}