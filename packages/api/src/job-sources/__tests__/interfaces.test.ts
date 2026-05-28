import { describe, it, expect, vi } from 'vitest'
import { JobSource, JobScraperResult } from '../interfaces'

describe('JobSource Interface', () => {
  it('should define required methods', () => {
    const mockSource: JobSource = {
      name: 'TestSource',
      canHandle: vi.fn().mockReturnValue(true),
      scrape: vi.fn().mockResolvedValue({ jobs: [], errors: [] })
    }

    expect(mockSource.name).toBeDefined()
    expect(typeof mockSource.canHandle).toBe('function')
    expect(typeof mockSource.scrape).toBe('function')
  })

  it('should return properly typed job results', async () => {
    const result: JobScraperResult = {
      jobs: [
        {
          title: 'Engineer',
          company: 'TechCorp',
          description: 'Build stuff',
          url: 'https://example.com/job/1',
          location: 'Remote',
          salary: '$100k-$150k',
          sourceUrl: 'https://example.com'
        }
      ],
      errors: [],
      source: 'TestSource'
    }

    expect(result.jobs.length).toBe(1)
    expect(result.jobs[0].title).toBe('Engineer')
    expect(result.source).toBe('TestSource')
  })
})
