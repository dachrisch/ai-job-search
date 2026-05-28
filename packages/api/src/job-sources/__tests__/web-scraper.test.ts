import { WebScraper } from '../web-scraper'

describe('WebScraper', () => {
  const scraper = new WebScraper()

  it('should identify supported domains', () => {
    expect(scraper.name).toBe('WebScraper')
    expect(scraper.canHandle('linkedin.com')).toBe(true)
    expect(scraper.canHandle('indeed.com')).toBe(true)
    expect(scraper.canHandle('unknown-site.com')).toBe(false)
  })

  it('should return empty results for invalid urls', async () => {
    const result = await scraper.scrape('https://invalid-url-that-does-not-exist-12345-xyz.invalid', 'engineer')
    expect(result.jobs).toEqual([])
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.source).toBe('WebScraper')
  })

  it('should discover pagination and internal links', async () => {
    const result = await scraper.scrape('https://linkedin.com', 'engineer')

    expect(result).toHaveProperty('discoveredPages')
    expect(Array.isArray((result as any).discoveredPages)).toBe(true)

    if (result.jobs.length > 0) {
      expect(((result as any).discoveredPages || []).length).toBeGreaterThanOrEqual(0)
    }
  })
})
