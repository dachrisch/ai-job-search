import { SearchService } from '../search-service'
import { PageAnalyzer } from '../page-analyzer'
import { SearchResult } from '../interfaces'

describe('Job Discovery Integration', () => {
  it('should handle empty search results with fallback', async () => {
    const searchService = new SearchService()
    const results = await searchService.search('xyz_super_rare_job_xyz_does_not_exist_12345')

    expect(Array.isArray(results)).toBe(true)
  })

  it('should prioritize relevant pages correctly', async () => {
    const pageAnalyzer = new PageAnalyzer()
    const testResults: SearchResult[] = [
      {
        url: 'https://linkedin.com/jobs',
        title: 'LinkedIn Jobs Search',
        snippet: 'Find job listings on LinkedIn',
        relevanceScore: 0.9
      },
      {
        url: 'https://example.com/blog',
        title: 'How to get a job',
        snippet: 'General advice',
        relevanceScore: 0.2
      }
    ]

    const analyzed = await pageAnalyzer.analyzePages(testResults, 'engineer')

    expect(analyzed[0].url).toContain('linkedin.com')
    expect(analyzed[0].priority).toBeGreaterThanOrEqual(analyzed[1]?.priority || 0)
  })
})
