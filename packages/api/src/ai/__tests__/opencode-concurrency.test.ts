import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { callOpencode, resetOpencodeStateForTests } from '../opencode.js'

describe('callOpencode concurrency gate (issue #187)', () => {
  const OLD_KEY = process.env.OPENCODE_API_KEY
  const OLD_MAX = process.env.OPENCODE_MAX_CONCURRENT

  let activeFetches = 0
  let maxActiveFetches = 0

  beforeEach(() => {
    resetOpencodeStateForTests()
    process.env.OPENCODE_API_KEY = 'test-key'
    process.env.OPENCODE_MAX_CONCURRENT = '1'
    activeFetches = 0
    maxActiveFetches = 0

    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
      activeFetches++
      maxActiveFetches = Math.max(maxActiveFetches, activeFetches)
      try {
        await new Promise(resolve => setTimeout(resolve, 20))
        const method = init?.method || 'GET'
        if (String(url).endsWith('/api/model')) {
          return { ok: false, status: 500, json: async () => ({}) } as any
        }
        if (method === 'POST' && String(url).endsWith('/api/session')) {
          return { ok: true, json: async () => ({ data: { id: 'ses1' } }) } as any
        }
        if (String(url).includes('/prompt')) {
          return { ok: true, json: async () => ({ data: {} }) } as any
        }
        return {
          ok: true,
          json: async () => ({
            data: [{ type: 'assistant', finish: 'stop', content: [{ type: 'text', text: 'hi' }] }],
          }),
        } as any
      } finally {
        activeFetches--
      }
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    if (OLD_KEY === undefined) delete process.env.OPENCODE_API_KEY
    else process.env.OPENCODE_API_KEY = OLD_KEY
    if (OLD_MAX === undefined) delete process.env.OPENCODE_MAX_CONCURRENT
    else process.env.OPENCODE_MAX_CONCURRENT = OLD_MAX
  })

  it('caps concurrent LLM calls so bursts do not trip the free-quota rate limit', { timeout: 30000 }, async () => {
    const results = await Promise.all([
      callOpencode('prompt 1'),
      callOpencode('prompt 2'),
      callOpencode('prompt 3'),
    ])

    expect(results).toEqual(['hi', 'hi', 'hi'])
    expect(maxActiveFetches).toBeLessThanOrEqual(1)
  })
})
