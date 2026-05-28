import axios from 'axios'
import * as cheerio from 'cheerio'
import { JobSource, JobScraperResult, JobSourceConfig } from './interfaces'
import { RateLimiter } from './rate-limiter'

export class WebScraper implements JobSource {
  name = 'WebScraper'
  private rateLimiter: RateLimiter
  private supportedDomains = ['linkedin.com', 'indeed.com', 'glassdoor.com', 'builtin.com', 'angel.co']

  constructor() {
    this.rateLimiter = new RateLimiter({ maxConcurrent: 2, delayMs: 1000 })
  }

  canHandle(domain: string): boolean {
    return this.supportedDomains.some(d => domain.includes(d))
  }

  async scrape(url: string, keywords: string, config?: JobSourceConfig): Promise<JobScraperResult> {
    const timeout = config?.timeout || 10000
    const errors: Array<{ message: string; site?: string }> = []

    try {
      const html = await this.rateLimiter.execute(() =>
        axios.get(url, {
          timeout,
          headers: { 'User-Agent': config?.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        }).then(res => res.data)
      )

      const $ = cheerio.load(html)
      const jobs: any[] = []

      // Generic job listing selector (works for many job boards)
      $('[data-job-id], [class*="job"], [class*="listing"]').slice(0, 10).each((_, element) => {
        const title = $(element).find('[class*="title"], h2, a').first().text().trim()
        const company = $(element).find('[class*="company"]').text().trim()
        const description = $(element).find('[class*="description"], p').first().text().trim().substring(0, 300)
        const jobUrl = $(element).find('a').attr('href') || url

        if (title && title.length > 3) {
          jobs.push({
            title,
            company: company || 'Unknown',
            description: description || 'No description available',
            url: jobUrl.startsWith('http') ? jobUrl : url,
            location: 'Remote', // Default; could be extracted with more specific selectors
            sourceUrl: url
          })
        }
      })

      return {
        jobs: jobs.slice(0, 10),
        errors,
        source: this.name
      }
    } catch (error: any) {
      errors.push({
        message: `Failed to scrape ${url}: ${error.message}`,
        site: url
      })
      return { jobs: [], errors, source: this.name }
    }
  }
}
