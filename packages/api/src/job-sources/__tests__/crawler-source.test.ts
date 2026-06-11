import { describe, it, expect, vi } from 'vitest'
import { CrawlerSource } from '../crawler-source'
import axios from 'axios'

vi.mock('axios')

describe.skipIf(process.env.CI === 'true')('CrawlerSource', () => {
  const source = new CrawlerSource()

  it('should call Python crawler service with correct payload', async () => {
    const mockResponse = {
      data: [
        {
          source: 'linkedin.com',
          jobs: [{ title: 'Test Job', company: 'Test Co', url: 'https://test.com', sourceUrl: 'https://test.com' }],
          errors: []
        }
      ]
    }
    vi.mocked(axios.post).mockResolvedValue(mockResponse)

    const results = await source.scrapeBulk(['https://linkedin.com/jobs/123'], 'node engineer')
    
    expect(axios.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        sites: ['https://linkedin.com/jobs/123'],
        keywords: 'node engineer'
      }),
      expect.any(Object)
    )
    expect(results[0].jobs[0].title).toBe('Test Job')
  })

  it('should handle service errors gracefully', async () => {
    vi.mocked(axios.post).mockRejectedValue(new Error('Network error'))

    const results = await source.scrapeBulk(['https://linkedin.com/jobs/123'], 'node engineer')
    
    expect(results[0].errors[0].message).toContain('Network error')
    expect(results[0].jobs).toHaveLength(0)
  })
})
