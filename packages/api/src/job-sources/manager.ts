import { JobSource, JobScraperResult, JobSourceConfig } from './interfaces'
import { WebScraper } from './web-scraper'

export class JobSourceManager {
  private sources: JobSource[] = []

  constructor() {
    this.initializeSources()
  }

  private initializeSources(): void {
    this.sources = [
      new WebScraper()
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
}
