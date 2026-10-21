import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  callOpencode,
  isFree,
  isUsable,
  resetOpencodeStateForTests,
  type RegistryModel,
} from '../opencode.js'

// V2 contract (opencode 2.1.2): the prompt body is `{text}`, the message page
// is newest-first and carries non-assistant turn entries after the assistant
// reply, and a cancelled run is stopped with /interrupt (there is no /abort).
const BASE = 'http://code.lehel.xyz'

const assistant = (finish?: string, text?: string) => ({
  type: 'assistant',
  ...(finish ? { finish } : {}),
  ...(text ? { content: [{ type: 'text', text }] } : {}),
})

const jsonResponse = (body: any, status = 200) => ({ ok: true, status, json: async () => body })

interface Call {
  url: string
  method: string
  body?: any
}

describe('callOpencode OpenCode V2 contract (issue #202)', () => {
  const ENV = ['OPENCODE_API_KEY', 'OPENCODE_MODELS', 'OPENCODE_PAID_MODEL', 'OPENCODE_POLL_TIMEOUT_MS'] as const
  const OLD_ENV = Object.fromEntries(ENV.map(name => [name, process.env[name]]))

  let calls: Call[]
  let pages: any[][]

  beforeEach(() => {
    resetOpencodeStateForTests()
    calls = []
    pages = []
    process.env.OPENCODE_API_KEY = 'test-key'
    process.env.OPENCODE_POLL_INTERVAL_MS = '1'
    process.env.OPENCODE_RETRY_DELAY_MS = '0'
    process.env.OPENCODE_UNAVAILABLE_RETRY_MS = '0'
    delete process.env.OPENCODE_POLL_TIMEOUT_MS
    delete process.env.OPENCODE_MODELS
    delete process.env.OPENCODE_PAID_MODEL
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    for (const name of ENV) {
      const value = OLD_ENV[name]
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  })

  /** Routes the V2 endpoints; `pages` is the sequence of message pages to serve. */
  function mockV2(models: any[]) {
    const fn = vi.fn(async (url: string, init?: any) => {
      const u = String(url)
      const method = init?.method ?? 'GET'
      calls.push({ url: u, method, body: init?.body })
      if (u.endsWith('/api/model')) return jsonResponse({ location: 'registry', data: models })
      if (u.endsWith('/api/session') && method === 'POST') return jsonResponse({ data: { id: 'ses_1' } })
      if (u.endsWith('/prompt')) return jsonResponse({ data: {} })
      if (u.endsWith('/interrupt')) return jsonResponse({ interrupted: true })
      if (method === 'DELETE' && u.endsWith('/api/session/ses_1')) return jsonResponse({ data: { id: 'ses_1' } })
      if (/\/message\?limit=50&order=desc$/.test(u)) {
        const page = pages.length > 1 ? pages.shift()! : pages[0]
        return jsonResponse({ data: page, cursor: { previous: null, next: null } })
      }
      throw new Error(`unexpected fetch ${method} ${u}`)
    })
    vi.stubGlobal('fetch', fn)
    return fn
  }

  const V2_MODEL = {
    id: 'v2-flash-free',
    modelID: 'v2-flash-free',
    providerID: 'opencode',
    cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }],
    status: 'active',
    enabled: true,
  }

  it('sends the prompt as {text} (V2 schema)', async () => {
    const fn = mockV2([V2_MODEL])
    pages = [[assistant('stop', 'hi')]]

    await expect(callOpencode('hello')).resolves.toBe('hi')

    const prompt = calls.find(c => c.url === `${BASE}/api/session/ses_1/prompt`)
    expect(prompt?.method).toBe('POST')
    expect(JSON.parse(prompt!.body)).toEqual({ text: 'hello' })
    expect(fn).toHaveBeenCalled()
  })

  it('resolves when the assistant reply is followed by a newer idle entry', async () => {
    mockV2([V2_MODEL])
    pages = [
      [
        { type: 'idle', outcome: 'succeeded' },
        assistant('stop', 'answer'),
        { type: 'user', content: [{ type: 'text', text: 'hello' }] },
      ],
    ]

    await expect(callOpencode('hello')).resolves.toBe('answer')

    expect(calls.filter(c => c.url.includes('/message'))).toHaveLength(1)
  })

  it('keeps polling while the newest assistant entry has no finish', async () => {
    mockV2([V2_MODEL])
    pages = [
      [{ type: 'idle', outcome: 'succeeded' }, assistant(undefined, 'partial'), assistant('stop', 'old answer')],
      [{ type: 'idle', outcome: 'succeeded' }, assistant('stop', 'final answer')],
    ]

    await expect(callOpencode('hello')).resolves.toBe('final answer')

    expect(calls.filter(c => c.url.includes('/message'))).toHaveLength(2)
  })

  it('keeps polling through tool-calls rounds until a terminal finish', async () => {
    mockV2([V2_MODEL])
    pages = [[assistant('tool-calls', 'thinking')], [assistant('stop', 'done')]]

    await expect(callOpencode('hello')).resolves.toBe('done')
    expect(calls.filter(c => c.url.includes('/message'))).toHaveLength(2)
  })

  it('interrupts and deletes a timed-out attempt, and never calls /abort', async () => {
    process.env.OPENCODE_POLL_TIMEOUT_MS = '20'
    mockV2([V2_MODEL])
    pages = [[{ type: 'idle', outcome: 'succeeded' }, assistant(undefined, 'never finishes')]]

    await expect(callOpencode('hello')).rejects.toThrow(/timed out/)

    const teardown = calls
      .filter(c => c.url.endsWith('/interrupt') || (c.method === 'DELETE' && c.url.endsWith('/api/session/ses_1')))
      .map(c => `${c.method} ${c.url}`)
    expect(teardown).toEqual([
      `POST ${BASE}/api/session/ses_1/interrupt`,
      `DELETE ${BASE}/api/session/ses_1`,
    ])
    expect(calls.some(c => c.url.includes('/abort'))).toBe(false)
  })

  it('accepts a V2 registry entry and picks it as the free model', async () => {
    const fn = mockV2([V2_MODEL])
    pages = [[assistant('stop', 'hi')]]

    await callOpencode('hello')

    const created = fn.mock.calls.find(([u, i]) => String(u).endsWith('/api/session') && i?.method === 'POST')
    expect(JSON.parse((created![1] as any).body).model).toEqual({ id: 'v2-flash-free', providerID: 'opencode' })
  })

  it('parses V2 registry entries with the exported helpers', () => {
    // V2 entries are a superset (modelID, cost[].cache): the parser keys off id/providerID.
    expect(V2_MODEL.modelID).toBe('v2-flash-free')
    const entry = V2_MODEL as unknown as RegistryModel
    expect(isUsable(entry)).toBe(true)
    expect(isFree(entry)).toBe(true)
    expect(isUsable({ ...entry, status: 'deprecated' })).toBe(false)
    expect(isFree({ ...entry, cost: [{ input: 0.15, output: 0.6 }] })).toBe(false)
  })
})
