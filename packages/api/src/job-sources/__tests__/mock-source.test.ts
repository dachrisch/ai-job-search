import { MockSource } from '../mock-source'

describe('MockSource', () => {
  const source = new MockSource()

  it('should handle any domain', () => {
    expect(source.canHandle('any-domain.com')).toBe(true)
    expect(source.canHandle('another.com')).toBe(true)
  })

  it('should return consistent mock jobs', async () => {
    const result = await source.scrape('https://example.com', 'software engineer')
    expect(result.jobs.length).toBe(6)
    expect(result.jobs[0].title).toBe('Senior Software Engineer')
    expect(result.errors.length).toBe(0)
    expect(result.source).toBe('MockSource')
  })

  it('should return results for multiple URLs via scrapeBulk', async () => {
    const urls = ['https://site1.com', 'https://site2.com']
    const results = await (source as any).scrapeBulk(urls, 'software engineer')
    expect(results.length).toBe(2)
    expect(results[0].jobs.length).toBe(6)
    expect(results[1].jobs.length).toBe(6)
  })
})
