import { describe, it, expect, vi, afterEach } from 'vitest'
import { callOpencode, extractFirstJsonValue, getOpenCodeBaseUrl } from '../src/ai/opencode.js'

const BASE = 'http://code.lehel.xyz'

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.OPENCODE_API_KEY
  delete process.env.OPENCODE_MODEL
  delete process.env.OPENCODE_FALLBACK_MODEL
  delete process.env.OPENCODE_BASE_URL
})

function mockFetchSequence(...responses: any[]) {
  const fn = vi.fn()
  responses.forEach(r => fn.mockResolvedValueOnce(r))
  fn.mockResolvedValue({ ok: true, json: async () => ({ data: [] }) })
  vi.stubGlobal('fetch', fn)
  return fn
}

function jsonResponse(ok: boolean, body: any, status = 200) {
  return { ok, status, json: async () => body }
}

describe('callOpencode', () => {
  it('should create a session, send a prompt, and return the finished reply', async () => {
    process.env.OPENCODE_API_KEY = 'test-key'

    mockFetchSequence(
      jsonResponse(true, { data: { id: 'ses_123' } }),
      jsonResponse(true, { data: {} }),
      jsonResponse(true, {
        data: [
          {
            type: 'assistant',
            finish: 'done',
            content: [{ type: 'text', text: '{"ok":true}' }],
          },
        ],
      })
    )

    const reply = await callOpencode('hello')

    expect(reply).toBe('{"ok":true}')
    expect(fetch).toHaveBeenCalledWith(`${BASE}/api/session`, expect.objectContaining({ method: 'POST' }))
    expect(fetch).toHaveBeenCalledWith(
      `${BASE}/api/session/ses_123/prompt`,
      expect.objectContaining({ method: 'POST' })
    )
    expect(fetch).toHaveBeenCalledWith(`${BASE}/api/session/ses_123/message`, expect.objectContaining({}))
  })

  it('should send the X-Api-Key header', async () => {
    process.env.OPENCODE_API_KEY = 'secret-key'

    mockFetchSequence(
      jsonResponse(true, { data: { id: 'ses_1' } }),
      jsonResponse(true, { data: {} }),
      jsonResponse(true, {
        data: [{ type: 'assistant', finish: 'done', content: [{ type: 'text', text: 'ok' }] }],
      })
    )

    await callOpencode('hello')

    const sessionCall = vi.mocked(fetch).mock.calls[0]
    const headers = (sessionCall[1] as any).headers
    expect(headers['X-Api-Key']).toBe('secret-key')
  })

  it('should retry then succeed on a transient session failure', async () => {
    process.env.OPENCODE_API_KEY = 'test-key'

    mockFetchSequence(
      jsonResponse(false, {}, 503),
      jsonResponse(true, { data: { id: 'ses_2' } }),
      jsonResponse(true, { data: {} }),
      jsonResponse(true, {
        data: [{ type: 'assistant', finish: 'done', content: [{ type: 'text', text: 'retried' }] }],
      })
    )

    const reply = await callOpencode('hello')
    expect(reply).toBe('retried')
  })

  it('should fail over to the fallback model when the primary exhausts attempts', async () => {
    process.env.OPENCODE_API_KEY = 'test-key'

    const fetchMock = vi.fn()
    fetchMock.mockResolvedValue(jsonResponse(false, {}, 503))
    vi.stubGlobal('fetch', fetchMock)

    await expect(callOpencode('hello')).rejects.toThrow(/session create failed/)

    // 2 models × 3 attempts = 6 session-create calls
    const sessionCalls = vi.mocked(fetch).mock.calls.filter(call => String(call[0]).endsWith('/api/session'))
    expect(sessionCalls).toHaveLength(6)
    const firstModel = JSON.parse((sessionCalls[0][1] as any).body).model.id
    const fallbackModel = JSON.parse((sessionCalls[3][1] as any).body).model.id
    expect(firstModel).toBe('mimo-v2.5-free')
    expect(fallbackModel).toBe('big-pickle')
  })

  it('should honor OPENCODE_MODEL / OPENCODE_FALLBACK_MODEL env overrides', async () => {
    process.env.OPENCODE_API_KEY = 'test-key'
    process.env.OPENCODE_MODEL = 'my-model'
    process.env.OPENCODE_FALLBACK_MODEL = 'my-fallback'

    const fetchMock = vi.fn()
    fetchMock.mockResolvedValue(jsonResponse(false, {}, 503))
    vi.stubGlobal('fetch', fetchMock)

    await expect(callOpencode('hello')).rejects.toThrow()

    const firstModel = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as any).body).model.id
    expect(firstModel).toBe('my-model')
  })

  it('should throw when OPENCODE_API_KEY is missing', async () => {
    await expect(callOpencode('hello')).rejects.toThrow('OPENCODE_API_KEY not configured')
  })

  it('should throw when the reply errors out', async () => {
    process.env.OPENCODE_API_KEY = 'test-key'

    const fetchMock = vi.fn()
    fetchMock.mockResolvedValue(
      jsonResponse(true, {
        data: [{ type: 'assistant', finish: 'error', error: { message: 'upstream 503' } }],
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(callOpencode('hello')).rejects.toThrow(/upstream 503/)
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