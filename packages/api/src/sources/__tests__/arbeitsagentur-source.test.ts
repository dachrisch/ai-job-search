// packages/api/src/sources/__tests__/arbeitsagentur-source.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  twoJobsResponse,
  emptyResponse,
  partialJobResponse,
  malformedResponse,
} from './arbeitsagentur-source.fixtures'

// Explicit factory + resetModules + dynamic import (the pattern crawl-company-handler.test.ts
// uses): under vitest's `isolate: false` the bare `vi.mock('axios')` automock does not
// reliably expose `axios.get` as a mock fn (it's undefined in CI), and another test file's
// `vi.resetModules()` can split the mock instance. This guarantees the test and the SUT
// always share one freshly-applied axios.get mock.
vi.mock('axios', () => ({ default: { get: vi.fn() } }))

let ArbeitsagenturSource: typeof import('../arbeitsagentur-source')['ArbeitsagenturSource']
let axios: typeof import('axios')['default']

describe('ArbeitsagenturSource', () => {
  let source: InstanceType<typeof ArbeitsagenturSource>

  beforeEach(async () => {
    vi.resetModules()
    ;({ ArbeitsagenturSource } = await import('../arbeitsagentur-source'))
    axios = (await import('axios')).default
    vi.clearAllMocks()
    source = new ArbeitsagenturSource()
  })

  it('queries the API with was= and maps postings to SourceJobs', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: twoJobsResponse } as any)

    const result = await source.search({ keywords: 'python entwickler', raw: 'python entwickler' })

    // Called the jobs endpoint with the keyword and the public API key header
    const [calledUrl, calledConfig] = vi.mocked(axios.get).mock.calls[0] as [string, any]
    expect(calledUrl).toContain('/jobsuche-service/pc/v4/jobs')
    expect(calledConfig?.params?.was).toBe('python entwickler')
    expect(calledConfig?.headers?.['X-API-Key']).toBe('jobboerse-jobsuche')

    // Mapped two jobs correctly
    expect(result.source).toBe('arbeitsagentur')
    expect(result.errors).toEqual([])
    expect(result.jobs).toHaveLength(2)

    const first = result.jobs[0]
    expect(first.title).toBe('Senior Python Entwickler (m/w/d)')
    expect(first.company).toBe('ACME GmbH')
    expect(first.location).toBe('Berlin')
    expect(first.sourceUrl).toBe('https://www.arbeitsagentur.de/jobsuche/')
    expect(first.url).toContain('10000-1198765432-S')
    expect(first.description.length).toBeGreaterThan(0)
  })

  it('returns no jobs and no errors for an empty result set', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: emptyResponse } as any)

    const result = await source.search({ keywords: 'cobol entwickler', raw: 'cobol entwickler' })

    expect(result.jobs).toEqual([])
    expect(result.errors).toEqual([])
  })

  it('fills sensible defaults when a posting is missing employer/location', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: partialJobResponse } as any)

    const result = await source.search({ keywords: 'werkstudent', raw: 'werkstudent' })

    expect(result.jobs).toHaveLength(1)
    expect(result.jobs[0].company).toBe('Unbekannt')
    expect(result.jobs[0].location).toBe('Deutschland')
  })

  it('maps location to wo and radius to umkreis', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: twoJobsResponse } as any)

    await source.search({ keywords: 'dev', location: 'Berlin', radius: 20, raw: 'dev berlin' })

    const [, calledConfig] = vi.mocked(axios.get).mock.calls[0] as [string, any]
    expect(calledConfig?.params?.wo).toBe('Berlin')
    expect(calledConfig?.params?.umkreis).toBe(20)
  })

  it('treats a malformed payload as zero jobs (no throw)', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: malformedResponse } as any)

    const result = await source.search({ keywords: 'python', raw: 'python' })

    expect(result.jobs).toEqual([])
    expect(result.errors).toEqual([])
  })
})
