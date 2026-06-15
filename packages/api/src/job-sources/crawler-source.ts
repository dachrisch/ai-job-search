import axios from 'axios'
import { JobSource, JobScraperResult, JobSourceConfig } from './interfaces.js'

export class CrawlerSource implements JobSource {
  name = 'CrawlerSource'
  private serviceUrl = process.env.CRAWLER_SERVICE_URL || 'http://localhost:5000'

  canHandle(domain: string): boolean {
    return true // Python service handles domain routing internally
  }

  async scrapeBulk(urls: string[], keywords: string, config?: JobSourceConfig): Promise<JobScraperResult[]> {
    try {
      const response = await axios.post(`${this.serviceUrl}/crawler/scrape`, {
        searchId: config?.searchId || 'unknown',
        sites: urls,
        keywords,
        config: {
          timeout: config?.timeout ? Math.round(config.timeout / 1000) : 30,
          maxRetries: config?.maxRetries || 3
        }
      }, { timeout: 35000 })

      return response.data.map((result: any) => ({
        source: result.source || 'CrawlerSource',
        jobs: result.jobs || [],
        errors: result.errors || [],
        timestamp: new Date()
      }))
    } catch (error: any) {
      console.error('CrawlerSource failed:', error.message)
      return urls.map(url => ({
        source: 'CrawlerSource',
        jobs: [],
        errors: [{ message: `Crawler service error: ${error.message}`, site: url }],
        timestamp: new Date()
      }))
    }
  }

  // Implementation for backward compatibility during transition
  async scrape(url: string, keywords: string, config?: JobSourceConfig): Promise<JobScraperResult> {
    const results = await this.scrapeBulk([url], keywords, config)
    return results[0]
  }
}
