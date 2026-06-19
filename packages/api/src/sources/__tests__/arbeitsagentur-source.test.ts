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
    expect(first.sourceUrl).toBe('arbeitsagentur')
    expect(first.url).toContain('10000-1198765432-S')
    expect(first.description.length).toBeGreaterThan(0)
  })
})
