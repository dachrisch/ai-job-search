import { SearchService } from '../search-service'
import { PageAnalyzer } from '../page-analyzer'
import { WebScraper } from '../web-scraper'
import { SearchResult } from '../interfaces'

describe('Job Discovery Integration', () => {
  it('should complete full discovery flow: search → analyze → scrape', async () => {
    const searchService = new SearchService()
    const pageAnalyzer = new PageAnalyzer()
    const scraper = new WebScraper()

    // Phase 1: Search
    const searchResults = await searchService.search('senior software engineer remote')
    expect(Array.isArray(searchResults)).toBe(true)

    if (searchResults.length === 0) {
      console.log('SearXNG unavailable, skipping integration test')
      return
    }

    // Phase 2: Analyze
    const analyzedPages = await pageAnalyzer.analyzePages(
      searchResults.slice(0, 5),
      'senior software engineer remote'
    )
    expect(analyzedPages.length).toBeGreaterThan(0)
    expect(analyzedPages[0].priority).toBeGreaterThan(0)

    // Phase 3: Scrape (mock domain for safety)
    const results = await scraper.scrape(['example.com'], 'engineer')
    expect(Array.isArray(results)).toBe(true)
    expect(results[0]).toHaveProperty('discoveredPages')
  })

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
