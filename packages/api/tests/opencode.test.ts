import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import {
  callOpencode,
  extractFirstJsonValue,
  getOpenCodeBaseUrl,
  resetOpencodeStateForTests,
} from '../src/ai/opencode.js'

const BASE = 'http://code.lehel.xyz'

beforeEach(() => {
  resetOpencodeStateForTests()
  process.env.OPENCODE_RETRY_DELAY_MS = '0'
  process.env.OPENCODE_POLL_INTERVAL_MS = '1'
  process.env.OPENCODE_UNAVAILABLE_RETRY_MS = '0'
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.OPENCODE_API_KEY
  delete process.env.OPENCODE_MODELS
  delete process.env.OPENCODE_PAID_MODEL
  delete process.env.OPENCODE_BASE_URL
  delete process.env.OPENCODE_RETRY_DELAY_MS
  delete process.env.OPENCODE_POLL_INTERVAL_MS
  delete process.env.OPENCODE_POLL_TIMEOUT_MS
  delete process.env.OPENCODE_UNAVAILABLE_RETRY_MS
  vi.restoreAllMocks()
})

function jsonResponse(ok: boolean, body: any, status = 200) {
  return { ok, status, json: async () => body }
}

const FREE = [{ input: 0, output: 0 }]
const PAID = [{ input: 0.15, output: 0.6 }]

function registryModel(providerID: string, id: string, cost = FREE, status = 'active') {
  return { id, providerID, status, enabled: true, cost }
}

/** Live-like registry: deprecated + paid entries must never lead the chain. */
const REGISTRY = [
  registryModel('opencode', 'mimo-v2.5-free', FREE, 'deprecated'),
  registryModel('opencode', 'fledge-alpha-free'),
  registryModel('opencode', 'big-pickle'),
  registryModel('opencode', 'mimo-v2.6-flash-free'),
  registryModel('opencode-go', 'deepseek-v4.1-flash', PAID),
  registryModel('opencode-go', 'glm-5.3-flash', PAID),
  registryModel('opencode-go', 'longcat-2.5-preview-free'),
]

const reply = (text: string) =>
  jsonResponse(true, { data: [{ type: 'assistant', finish: 'done', content: [{ type: 'text', text }] }] })
const pending = () => jsonResponse(true, { data: [{ type: 'assistant' }] })
const edge = (status: number, text: string) => ({ ok: false, status, json: async () => { throw new Error('not json') }, text: async () => text })
const replyError = (message: string) =>
  jsonResponse(true, { data: [{ type: 'assistant', finish: 'error', error: { message } }] })

/**
 * Route-based fetch stub. `models` answers GET /api/model; `perModel` decides the
 * message-poll reply for a session based on the model it was created with.
 */
function mockOpencode(opts: {
  models?: any
  perModel?: (modelKey: string) => any
  sessionCreate?: () => any
}) {
  let counter = 0
  const sessionModel = new Map<string, string>()
  const fn = vi.fn(async (url: string, init?: any) => {
    const u = String(url)
    if (u.endsWith('/api/model')) {
      return opts.models === undefined ? jsonResponse(false, {}, 401) : jsonResponse(true, { data: opts.models })
    }
    if (u.endsWith('/api/session') && init?.method === 'POST') {
      if (opts.sessionCreate) return opts.sessionCreate()
      const id = `ses_${++counter}`
      const model = JSON.parse(init.body).model
      sessionModel.set(id, `${model.providerID}:${model.id}`)
      return jsonResponse(true, { data: { id } })
    }
    if (u.endsWith('/prompt')) return jsonResponse(true, { data: {} })
    const match = u.match(/\/api\/session\/(ses_\d+)\/message$/)
    if (match) return (opts.perModel ?? (() => reply('ok')))(sessionModel.get(match[1])!)
    throw new Error(`unexpected fetch ${u}`)
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

function sessionModels(fn: ReturnType<typeof vi.fn>): string[] {
  return fn.mock.calls
    .filter(([url, init]) => String(url).endsWith('/api/session') && init?.method === 'POST')
    .map(([, init]) => {
      const m = JSON.parse(init.body).model
      return `${m.providerID}:${m.id}`
    })
}

describe('callOpencode', () => {
  it('should create a session, send a prompt, and return the finished reply', async () => {
    process.env.OPENCODE_API_KEY = 'test-key'
    mockOpencode({ models: REGISTRY, perModel: () => reply('{"ok":true}') })

    const result = await callOpencode('hello')

    expect(result).toBe('{"ok":true}')
    expect(fetch).toHaveBeenCalledWith(`${BASE}/api/session`, expect.objectContaining({ method: 'POST' }))
    expect(fetch).toHaveBeenCalledWith(`${BASE}/api/session/ses_1/prompt`, expect.objectContaining({ method: 'POST' }))
    expect(fetch).toHaveBeenCalledWith(`${BASE}/api/session/ses_1/message`, expect.objectContaining({}))
  })

  it('should send the X-Api-Key header on discovery and session calls', async () => {
    process.env.OPENCODE_API_KEY = 'secret-key'
    const fn = mockOpencode({ models: REGISTRY })

    await callOpencode('hello')

    for (const [, init] of fn.mock.calls) {
      expect((init as any).headers['X-Api-Key']).toBe('secret-key')
    }
  })

  it('should lead with the preferred active free model and skip deprecated ones', async () => {
    process.env.OPENCODE_API_KEY = 'test-key'
    const fn = mockOpencode({ models: REGISTRY })

    await callOpencode('hello')

    expect(sessionModels(fn)).toEqual(['opencode:mimo-v2.6-flash-free'])
  })

  it('should order the chain: preferred free, other free (opencode provider only), then the paid model', async () => {
    process.env.OPENCODE_API_KEY = 'test-key'
    const fn = mockOpencode({ models: REGISTRY, perModel: () => replyError('upstream broke') })

    await expect(callOpencode('hello')).rejects.toThrow(/upstream broke/)

    const tried = [...new Set(sessionModels(fn))]
    expect(tried).toEqual([
      'opencode:mimo-v2.6-flash-free',
      'opencode:big-pickle',
      'opencode:fledge-alpha-free',
      'opencode-go:deepseek-v4.1-flash',
    ])
  })

  it('should fail over immediately on a free-usage 429 without retrying that model', async () => {
    process.env.OPENCODE_API_KEY = 'test-key'
    const fn = mockOpencode({
      models: REGISTRY,
      perModel: model =>
        model === 'opencode:mimo-v2.6-flash-free'
          ? replyError('Provider request failed with HTTP 429: {"type":"FreeUsageLimitError"}')
          : reply(`answered by ${model}`),
    })

    const result = await callOpencode('hello')

    expect(result).toBe('answered by opencode:big-pickle')
    expect(sessionModels(fn)).toEqual(['opencode:mimo-v2.6-flash-free', 'opencode:big-pickle'])
  })

  it('should skip a quota-exhausted model on later calls (cooldown)', async () => {
    process.env.OPENCODE_API_KEY = 'test-key'
    const fn = mockOpencode({
      models: REGISTRY,
      perModel: model =>
        model === 'opencode:mimo-v2.6-flash-free' ? replyError('Rate limit exceeded') : reply('ok'),
    })

    await callOpencode('first')
    fn.mockClear()
    await callOpencode('second')

    expect(sessionModels(fn)).toEqual(['opencode:big-pickle'])
  })

  it('should fall back to the paid model when every free model is rate-limited', async () => {
    process.env.OPENCODE_API_KEY = 'test-key'
    mockOpencode({
      models: REGISTRY,
      perModel: model => (model.startsWith('opencode:') ? replyError('HTTP 429 FreeUsageLimitError') : reply('paid ok')),
    })

    await expect(callOpencode('hello')).resolves.toBe('paid ok')
  })

  it('should use the pinned chain when model discovery is unauthorized', async () => {
    process.env.OPENCODE_API_KEY = 'test-key'
    const fn = mockOpencode({ models: undefined, perModel: () => replyError('down') })

    await expect(callOpencode('hello')).rejects.toThrow(/down/)

    expect([...new Set(sessionModels(fn))]).toEqual([
      'opencode:mimo-v2.6-flash-free',
      'opencode:big-pickle',
      'opencode:nemotron-3.5-lightning-free',
      'opencode:nemotron-3-ultra-free',
      'opencode:ling-3.1-flash-free',
      'opencode-go:deepseek-v4.1-flash',
    ])
  })

  it('should cache discovery between calls', async () => {
    process.env.OPENCODE_API_KEY = 'test-key'
    const fn = mockOpencode({ models: REGISTRY })

    await callOpencode('one')
    await callOpencode('two')

    expect(fn.mock.calls.filter(([url]) => String(url).endsWith('/api/model'))).toHaveLength(1)
  })

  it('should honor OPENCODE_MODELS and OPENCODE_PAID_MODEL overrides', async () => {
    process.env.OPENCODE_API_KEY = 'test-key'
    process.env.OPENCODE_MODELS = 'opencode:big-pickle'
    process.env.OPENCODE_PAID_MODEL = 'opencode-go:glm-5.3-flash'
    const fn = mockOpencode({ models: REGISTRY, perModel: () => replyError('nope') })

    await expect(callOpencode('hello')).rejects.toThrow()

    expect([...new Set(sessionModels(fn))]).toEqual(['opencode:big-pickle', 'opencode-go:glm-5.3-flash'])
  })

  it('should retry then succeed on a transient session failure', async () => {
    process.env.OPENCODE_API_KEY = 'test-key'
    let failed = false
    const base = mockOpencode({ models: REGISTRY })
    const impl = base.getMockImplementation()!
    base.mockImplementation(async (url: string, init?: any) => {
      if (String(url).endsWith('/api/session') && init?.method === 'POST' && !failed) {
        failed = true
        return jsonResponse(false, {}, 503)
      }
      return impl(url, init)
    })

    await expect(callOpencode('hello')).resolves.toBe('ok')
  })

  it('should move on after a single hung attempt and cool the hung model down', async () => {
    process.env.OPENCODE_API_KEY = 'test-key'
    process.env.OPENCODE_POLL_TIMEOUT_MS = '20'
    const fn = mockOpencode({
      models: REGISTRY,
      perModel: model => (model === 'opencode:mimo-v2.6-flash-free' ? pending() : reply(`answered by ${model}`)),
    })

    await expect(callOpencode('first')).resolves.toBe('answered by opencode:big-pickle')
    expect(sessionModels(fn)).toEqual(['opencode:mimo-v2.6-flash-free', 'opencode:big-pickle'])

    fn.mockClear()
    await callOpencode('second')
    expect(sessionModels(fn)).toEqual(['opencode:big-pickle'])
  })

  it('should log every failed attempt with model and reason', async () => {
    process.env.OPENCODE_API_KEY = 'test-key'
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockOpencode({
      models: REGISTRY,
      perModel: model =>
        model === 'opencode:mimo-v2.6-flash-free' ? replyError('HTTP 429 FreeUsageLimitError') : reply('ok'),
    })

    await callOpencode('hello')

    const lines = warn.mock.calls.map(c => String(c[0]))
    expect(lines.some(l => l.includes('opencode:mimo-v2.6-flash-free') && l.includes('FreeUsageLimitError'))).toBe(true)
  })

  it('should wait out an opencode restart on the same model instead of failing over (edge 405)', async () => {
    process.env.OPENCODE_API_KEY = 'test-key'
    let creates = 0
    const fn = mockOpencode({ models: REGISTRY })
    const impl = fn.getMockImplementation()!
    fn.mockImplementation(async (url: string, init?: any) => {
      if (String(url).endsWith('/api/session') && init?.method === 'POST' && ++creates <= 4) {
        return edge(405, 'Method Not Allowed')
      }
      return impl(url, init)
    })

    await expect(callOpencode('hello')).resolves.toBe('ok')

    // 4 refused creates + 1 accepted, all on the first model — no failover burned
    const models = fn.mock.calls
      .filter(([u, i]) => String(u).endsWith('/api/session') && i?.method === 'POST')
      .map(([, i]) => JSON.parse(i.body).model.id)
    expect(new Set(models)).toEqual(new Set(['mimo-v2.6-flash-free']))
  })

  it('should treat 5xx and connection errors as opencode unavailable', async () => {
    process.env.OPENCODE_API_KEY = 'test-key'
    let creates = 0
    const fn = mockOpencode({ models: REGISTRY })
    const impl = fn.getMockImplementation()!
    fn.mockImplementation(async (url: string, init?: any) => {
      if (String(url).endsWith('/api/session') && init?.method === 'POST') {
        creates++
        if (creates === 1) throw new TypeError('fetch failed')
        if (creates === 2) return edge(502, 'Bad Gateway')
      }
      return impl(url, init)
    })

    await expect(callOpencode('hello')).resolves.toBe('ok')
    expect(sessionModels(fn).every(m => m === 'opencode:mimo-v2.6-flash-free')).toBe(true)
  })

  it('should give up with an unavailable error when opencode stays down', async () => {
    process.env.OPENCODE_API_KEY = 'test-key'
    const fn = mockOpencode({ models: REGISTRY })
    const impl = fn.getMockImplementation()!
    fn.mockImplementation(async (url: string, init?: any) => {
      if (String(url).endsWith('/api/session') && init?.method === 'POST') return edge(503, 'Service Unavailable')
      return impl(url, init)
    })

    await expect(callOpencode('hello')).rejects.toThrow(/opencode unavailable/)
  })

  it('should throw when OPENCODE_API_KEY is missing', async () => {
    await expect(callOpencode('hello')).rejects.toThrow('OPENCODE_API_KEY not configured')
  })
})

describe('getOpenCodeBaseUrl', () => {
  it('should default to production', () => {
    expect(getOpenCodeBaseUrl()).toBe(BASE)
  })

  it('should honor OPENCODE_BASE_URL', () => {
    process.env.OPENCODE_BASE_URL = 'https://opencode.example.com'
    expect(getOpenCodeBaseUrl()).toBe('https://opencode.example.com')
  })
})

describe('extractFirstJsonValue', () => {
  it('should extract a JSON object ignoring trailing prose', () => {
    expect(extractFirstJsonValue('Here you go: {"a":1, "b":{"c":2}}\n\nThanks!')).toBe('{"a":1, "b":{"c":2}}')
  })

  it('should extract a JSON array ignoring surrounding text', () => {
    expect(extractFirstJsonValue('Results: [{"url":"x"}, {"url":"y"}] done')).toBe('[{"url":"x"}, {"url":"y"}]')
  })

  it('should handle nested braces inside strings', () => {
    expect(extractFirstJsonValue('{"s":"{not json}","n":1}')).toBe('{"s":"{not json}","n":1}')
  })

  it('should throw when no JSON is present', () => {
    expect(() => extractFirstJsonValue('no json here')).toThrow('did not contain JSON')
  })

  it('should throw on unterminated JSON', () => {
    expect(() => extractFirstJsonValue('{"a":1')).toThrow('unterminated')
  })
})