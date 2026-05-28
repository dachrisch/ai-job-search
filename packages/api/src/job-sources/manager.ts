import { JobSource, JobScraperResult, JobSourceConfig } from './interfaces'
import { WebScraper } from './web-scraper'
import { MockSource } from './mock-source'

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
      new WebScraper(),
      new MockSource() // Fallback source always available
      // More sources can be added here (LinkedInScraper, IndeedAPI, etc.)
    ]
  }

  getSources(): JobSource[] {
    return this.sources
  }

  findSourcesForDomains(domains: string[]): JobSource[] {
    return this.sources.filter(source =>
      domains.some(domain => source.canHandle(domain))
    )
  }

  async scrapeJobs(
    domains: string[],
    keywords: string,
    config?: JobSourceConfig
  ): Promise<JobScraperResult[]> {
    const sources = this.findSourcesForDomains(domains)

    if (sources.length === 0) {
      console.warn(`No scrapers found for domains: ${domains.join(', ')}`)
      return [{
        jobs: [],
        errors: [{ message: `No job sources available for domains: ${domains.join(', ')}` }],
        source: 'JobSourceManager'
      }]
    }

    const results = await Promise.all(
      domains.map(async (domain) => {
        const source = sources.find(s => s.canHandle(domain))
        if (!source) {
          return {
            jobs: [],
            errors: [{ message: `No scraper for domain: ${domain}`, site: domain }],
            source: 'JobSourceManager'
          }
        }

        try {
          return await source.scrape(`https://${domain}/jobs`, keywords, config)
        } catch (error: any) {
          return {
            jobs: [],
            errors: [{ message: `Scraper failed: ${error.message}`, site: domain }],
            source: source.name
          }
        }
      })
    )

    return results
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

        // Scrape the page
        const results = await this.scrapeJobs([this.extractDomain(url)], keywords)

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

  private extractDomain(url: string): string {
    try {
      return new URL(url).hostname || 'unknown'
    } catch {
      return 'unknown'
    }
  }
}
