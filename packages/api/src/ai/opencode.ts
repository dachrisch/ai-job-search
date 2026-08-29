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
const RETRY_DELAY_MS = 1000

interface OpencodeMessage {
  type: 'user' | 'assistant'
  finish?: string
  content?: Array<{ type: string; text?: string }>
  error?: { message: string }
}

interface OpenCodeModel {
  id: string
  providerID: string
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

// Left unspecified, opencode picks its own default model — pin specific
// models instead. Primary is the fastest responsive free model on the
// opencode (OpenCode Zen) provider; the fallback is a distinct free model
// tried only after the primary exhausts every attempt (rate limits and
// outages are provider-side per-model). Both overridable via env.
function getModels(): OpenCodeModel[] {
  const primary = process.env.OPENCODE_MODEL || 'mimo-v2.5-free'
  const fallback = process.env.OPENCODE_FALLBACK_MODEL || 'big-pickle'
  const models: OpenCodeModel[] = [{ id: primary, providerID: 'opencode' }]
  if (fallback && fallback !== primary) {
    models.push({ id: fallback, providerID: 'opencode' })
  }
  return models
}

/**
 * Runs a prompt against the opencode instance and returns the assistant's
 * text reply. Retries per model with exponential backoff and fails over to a
 * fallback model when a model is persistently unhealthy. Throws on failure.
 */
export async function callOpencode(prompt: string): Promise<string> {
  const models = getModels()
  let lastError: unknown
  for (const model of models) {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const sessionId = await createSession(model)
        await sendPrompt(sessionId, prompt)
        return await pollForReply(sessionId)
      } catch (err) {
        lastError = err
        if (attempt < MAX_ATTEMPTS) {
          await sleep(RETRY_DELAY_MS * 2 ** (attempt - 1))
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