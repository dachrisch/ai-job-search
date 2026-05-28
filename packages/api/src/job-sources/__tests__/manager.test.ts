import { JobSourceManager } from '../manager'

describe('JobSourceManager', () => {
  const manager = new JobSourceManager()

  it('should register and retrieve job sources', () => {
    const sources = manager.getSources()
    expect(sources.length).toBeGreaterThan(0)
    expect(sources.some(s => s.name === 'WebScraper')).toBe(true)
  })

  it('should find sources that can handle a domain', () => {
    const matchingSources = manager.findSourcesForDomains(['linkedin.com', 'unknown.com'])
    expect(matchingSources.length).toBeGreaterThan(0)
  })

  it('should scrape jobs from multiple sources', async () => {
    const results = await manager.scrapeJobs(['linkedin.com'], 'software engineer')
    expect(Array.isArray(results)).toBe(true)
    expect(results.length > 0 || results.some(r => r.errors.length > 0)).toBe(true)
  })
})
