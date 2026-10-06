// packages/api/src/sources/__tests__/arbeitsagentur-source.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  twoJobsResponse,
  emptyResponse,
  partialJobResponse,
  malformedResponse,
  pageResponse,
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

  it('queries the v6 API with was= and maps postings to SourceJobs', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: twoJobsResponse } as any)

    const result = await source.search({ keywords: 'product manager', raw: 'product manager' })

    // Called the v6 jobs endpoint with the keyword, page size 50 and the public API key header
    const [calledUrl, calledConfig] = vi.mocked(axios.get).mock.calls[0] as [string, any]
    expect(calledUrl).toContain('/jobsuche-service/pc/v6/jobs')
    expect(calledConfig?.params?.was).toBe('product manager')
    expect(calledConfig?.params?.size).toBe(50)
    expect(calledConfig?.params?.page).toBe(1)
    expect(calledConfig?.headers?.['X-API-Key']).toBe('jobboerse-jobsuche')

    // Mapped two jobs correctly
    expect(result.source).toBe('arbeitsagentur')
    expect(result.errors).toEqual([])
    expect(result.jobs).toHaveLength(2)

    const first = result.jobs[0]
    expect(first.title).toBe('Product Manager (m/w/d)')
    expect(first.company).toBe('Edenred Deutschland GmbH')
    expect(first.location).toBe('München')
    expect(first.sourceUrl).toBe('https://www.arbeitsagentur.de/jobsuche/')
    expect(first.url).toBe('https://www.arbeitsagentur.de/jobsuche/jobdetail/10001-1003266561-S')
  })

  it('builds the description from the structured v6 fields', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: twoJobsResponse } as any)

    const result = await source.search({ keywords: 'product manager', raw: 'product manager' })

    const description = result.jobs[0].description
    expect(description).toContain('Product Manager (m/w/d) bei Edenred Deutschland GmbH in München')
    expect(description).toContain('Produktentwickler/in')
    expect(description).toContain('58.000–70.000 EUR')
    expect(description).toContain('Homeoffice möglich')
    expect(description).toContain('2026-06-22')
  })

  it('fetches a second page only when the first page is full', async () => {
    vi.mocked(axios.get)
      .mockResolvedValueOnce({ data: pageResponse('p1', 50) } as any)
      .mockResolvedValueOnce({ data: pageResponse('p2', 20) } as any)

    const result = await source.search({ keywords: 'product manager', raw: 'product manager' })

    expect(vi.mocked(axios.get)).toHaveBeenCalledTimes(2)
    const [, secondConfig] = vi.mocked(axios.get).mock.calls[1] as [string, any]
    expect(secondConfig?.params?.page).toBe(2)
    expect(result.jobs).toHaveLength(70)
  })

  it('stops after the first page when it is not full', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: twoJobsResponse } as any)

    await source.search({ keywords: 'product manager', raw: 'product manager' })

    expect(vi.mocked(axios.get)).toHaveBeenCalledTimes(1)
  })

  it('dedupes postings that appear on both pages', async () => {
    const page1 = pageResponse('p1', 50)
    const page2 = { ...pageResponse('p2', 10), ergebnisliste: [...pageResponse('p2', 10).ergebnisliste, page1.ergebnisliste[0]] }
    vi.mocked(axios.get)
      .mockResolvedValueOnce({ data: page1 } as any)
      .mockResolvedValueOnce({ data: page2 } as any)

    const result = await source.search({ keywords: 'product manager', raw: 'product manager' })

    expect(result.jobs).toHaveLength(60)
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
