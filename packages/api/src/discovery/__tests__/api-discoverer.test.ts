import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../claude/client.js', () => ({
  callClaude: vi.fn(),
}))

// With the repo's vitest isolate:false setting, the module registry is shared across
// test files within a worker. tests/handlers.test.ts auto-mocks claude/client.js too, so
// a stale cached instance can otherwise leak in here depending on file/thread scheduling.
// Force a fresh import bound to *our* mock every test.
let discoverJobsApi: typeof import('../api-discoverer.js')['discoverJobsApi']
let callClaude: typeof import('../../claude/client.js')['callClaude']

beforeEach(async () => {
  vi.resetModules()
  ;({ discoverJobsApi } = await import('../api-discoverer.js'))
  ;({ callClaude } = await import('../../claude/client.js'))
  vi.clearAllMocks()
})

const CAPTURE = [
  {
    url: 'https://ibm.wd3.myworkdayjobs.com/api/jobs?limit=20',
    method: 'GET',
    responseBody: JSON.stringify({ jobs: [{ title: 'Engineer', city: 'Berlin' }] }),
    responseStatus: 200,
  },
]

describe('discoverJobsApi', () => {
  it('returns config when Claude returns valid JSON with high confidence', async () => {
    const claudeResponse = JSON.stringify({
      endpoint: 'https://ibm.wd3.myworkdayjobs.com/api/jobs',
      method: 'GET',
      paramTemplate: { searchText: '{keywords}', limit: 50 },
      fieldMapping: { title: 'title', url: 'externalUrl', location: 'city', description: 'summary' },
      platform: 'workday',
      confidence: 0.9,
    })
    vi.mocked(callClaude).mockResolvedValue(claudeResponse)

    const config = await discoverJobsApi('user1', 'IBM', 'https://ibm.com/careers', CAPTURE)

    expect(config).not.toBeNull()
    expect(config!.endpoint).toBe('https://ibm.wd3.myworkdayjobs.com/api/jobs')
    expect(config!.platform).toBe('workday')
    expect(config!.discoveredAt).toBeInstanceOf(Date)
  })

  it('returns null when confidence is below 0.6', async () => {
    vi.mocked(callClaude).mockResolvedValue(JSON.stringify({
      endpoint: 'https://ibm.com/api/jobs',
      method: 'GET',
      paramTemplate: {},
      fieldMapping: { title: 'title', url: 'url', location: 'loc', description: 'desc' },
      confidence: 0.4,
    }))

    const config = await discoverJobsApi('user1', 'IBM', 'https://ibm.com/careers', CAPTURE)
    expect(config).toBeNull()
  })

  it('returns null when Claude returns invalid JSON', async () => {
    vi.mocked(callClaude).mockResolvedValue('Sorry, I cannot determine the API.')
    const config = await discoverJobsApi('user1', 'IBM', 'https://ibm.com/careers', CAPTURE)
    expect(config).toBeNull()
  })

  it('returns null when callClaude throws', async () => {
    vi.mocked(callClaude).mockRejectedValue(new Error('API timeout'))
    const config = await discoverJobsApi('user1', 'IBM', 'https://ibm.com/careers', CAPTURE)
    expect(config).toBeNull()
  })

  it('strips markdown code fences from Claude response', async () => {
    const json = JSON.stringify({
      endpoint: 'https://ibm.com/api/jobs',
      method: 'GET',
      paramTemplate: { q: '{keywords}' },
      fieldMapping: { title: 'title', url: 'url', location: 'loc', description: 'desc' },
      confidence: 0.8,
    })
    vi.mocked(callClaude).mockResolvedValue('```json\n' + json + '\n```')

    const config = await discoverJobsApi('user1', 'IBM', 'https://ibm.com/careers', CAPTURE)
    expect(config).not.toBeNull()
    expect(config!.endpoint).toBe('https://ibm.com/api/jobs')
  })
})
