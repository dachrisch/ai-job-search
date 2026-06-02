import { JobSource, JobScraperResult, JobSourceConfig } from './interfaces.js'
import { CrawlerSource } from './crawler-source.js'
import { MockSource } from './mock-source.js'

export interface AggregatedResults {
  source: string
  jobs: any[]
  discoveredPages: any[]
  errors: any[]
}

export class JobSourceManager {
  private sources: JobSource[] = []
  private discoveryQueue: Map<string, Set<string>> = new Map() // searchId -> Set<urls>
  private scrapedPages: Map<string, Set<string>> = new Map() // searchId -> Set<urls>

  constructor() {
    this.initializeSources()
  }

  private initializeSources(): void {
    this.sources = [
      new CrawlerSource(), // Primary
      new MockSource()    // Fallback
    ]
  }

  async scrapeJobs(urls: string[], keywords: string, config?: JobSourceConfig): Promise<JobScraperResult[]> {
    // Try CrawlerSource first
    const crawler = this.sources.find(s => s instanceof CrawlerSource)
    if (crawler) {
      const results = await crawler.scrapeBulk(urls, keywords, config)
      
      // If we got jobs, return them
      if (results.some(r => r.jobs.length > 0)) {
        return results
      }
      
      // If we got no jobs and there were errors, we might want to try fallback
      // but for now let's just return what we got if it's the primary source
      // unless all results were errors
      if (results.every(r => r.jobs.length === 0 && r.errors.length > 0)) {
        console.log('CrawlerSource failed completely, trying fallbacks...')
      } else {
        return results
      }
    }

    // Fallback to MockSource if needed or if primary failed
    const mock = this.sources.find(s => s instanceof MockSource)
    if (mock) {
      return mock.scrapeBulk(urls, keywords, config)
    }

    return []
  }

  getSources(): JobSource[] {
    return this.sources
  }

  findSourcesForDomains(domains: string[]): JobSource[] {
    const matching = this.sources.filter(s =>
      domains.some(domain => s.canHandle(domain))
    )
    return matching.length > 0 ? matching : this.sources
  }

  async scrapeWithDiscovery(
    searchId: string,
    initialUrls: string[],
    keywords: string,
    maxIterations: number = 3
  ): Promise<AggregatedResults> {
    // Initialize queues for this search
    this.discoveryQueue.set(searchId, new Set(initialUrls))
    this.scrapedPages.set(searchId, new Set())

    let allJobs: any[] = []
    let iteration = 0

    while (iteration < maxIterations) {
      const queue = this.discoveryQueue.get(searchId)
      if (!queue || queue.size === 0) break

      // Get next batch of pages to scrape
      const pagesToScrape = Array.from(queue).slice(0, 5)

      for (const url of pagesToScrape) {
        queue.delete(url)

        // Skip if already scraped
        const scraped = this.scrapedPages.get(searchId)!
        if (scraped.has(url)) continue
        scraped.add(url)

        // Scrape the page - Using scrapeJobs which now calls CrawlerSource.scrapeBulk
        const results = await this.scrapeJobs([url], keywords)

        // Collect jobs
        results.forEach(result => {
          allJobs.push(...result.jobs)

          // Add discovered pages to queue
          if ('discoveredPages' in result && result.discoveredPages) {
            (result.discoveredPages as any[]).forEach((page: any) => {
              if (!scraped.has(page.url)) {
                queue.add(page.url)
              }
            })
          }
        })
      }

      iteration++
    }

    // Cleanup
    this.discoveryQueue.delete(searchId)
    this.scrapedPages.delete(searchId)

    return {
      source: 'JobSourceManager (with discovery)',
      jobs: allJobs,
      discoveredPages: [],
      errors: []
    }
  }
}
