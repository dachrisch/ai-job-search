// packages/api/src/sources/__tests__/arbeitsagentur-source.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import axios from 'axios'
import { ArbeitsagenturSource } from '../arbeitsagentur-source'
import { twoJobsResponse } from './arbeitsagentur-source.fixtures'

vi.mock('axios')

describe('ArbeitsagenturSource', () => {
  const source = new ArbeitsagenturSource()

  beforeEach(() => {
    vi.mocked(axios.get).mockReset()
  })

  it('queries the API with was= and maps postings to SourceJobs', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: twoJobsResponse })

    const result = await source.search({ keywords: 'python entwickler', raw: 'python entwickler' })

    // Called the jobs endpoint with the keyword and the public API key header
    const [calledUrl, calledConfig] = vi.mocked(axios.get).mock.calls[0]
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
    const { emptyResponse } = await import('./arbeitsagentur-source.fixtures')
    vi.mocked(axios.get).mockResolvedValue({ data: emptyResponse })

    const result = await source.search({ keywords: 'cobol entwickler', raw: 'cobol entwickler' })

    expect(result.jobs).toEqual([])
    expect(result.errors).toEqual([])
  })

  it('fills sensible defaults when a posting is missing employer/location', async () => {
    const { partialJobResponse } = await import('./arbeitsagentur-source.fixtures')
    vi.mocked(axios.get).mockResolvedValue({ data: partialJobResponse })

    const result = await source.search({ keywords: 'werkstudent', raw: 'werkstudent' })

    expect(result.jobs).toHaveLength(1)
    expect(result.jobs[0].company).toBe('Unbekannt')
    expect(result.jobs[0].location).toBe('Deutschland')
  })

  it('maps location to wo and radius to umkreis', async () => {
    const { twoJobsResponse } = await import('./arbeitsagentur-source.fixtures')
    vi.mocked(axios.get).mockResolvedValue({ data: twoJobsResponse })

    await source.search({ keywords: 'dev', location: 'Berlin', radius: 20, raw: 'dev berlin' })

    const [, calledConfig] = vi.mocked(axios.get).mock.calls[0]
    expect(calledConfig?.params?.wo).toBe('Berlin')
    expect(calledConfig?.params?.umkreis).toBe(20)
  })

  it('treats a malformed payload as zero jobs (no throw)', async () => {
    const { malformedResponse } = await import('./arbeitsagentur-source.fixtures')
    vi.mocked(axios.get).mockResolvedValue({ data: malformedResponse })

    const result = await source.search({ keywords: 'python', raw: 'python' })

    expect(result.jobs).toEqual([])
    expect(result.errors).toEqual([])
  })
})
