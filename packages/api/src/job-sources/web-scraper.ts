import axios from 'axios'
import * as cheerio from 'cheerio'
import { JobSource, JobScraperResult, JobSourceConfig, DiscoveredPage } from './interfaces'
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

      const discoveredPages = this.discoverPages(html, url)

      return {
        jobs: jobs.slice(0, 10),
        discoveredPages,
        errors,
        source: this.name
      } as any
    } catch (error: any) {
      errors.push({
        message: `Failed to scrape ${url}: ${error.message}`,
        site: url
      })
      return {
        jobs: [],
        discoveredPages: [],
        errors,
        source: this.name
      } as any
    }
  }

  private discoverPages(html: string, baseUrl: string): DiscoveredPage[] {
    const discovered: DiscoveredPage[] = []
    const seen = new Set<string>()

    try {
      const $ = cheerio.load(html)

      // Find pagination links
      const paginationPatterns = [
        'a[href*="?page="]',
        'a[href*="?p="]',
        'a[href*="/page/"]',
        'a:contains("next")',
        'a:contains("Next")',
        'a:contains("pagination")'
      ]

      paginationPatterns.forEach(selector => {
        $(selector).each((i, elem) => {
          const href = $(elem).attr('href')
          if (href) {
            const absoluteUrl = this.resolveUrl(href, baseUrl)
            if (absoluteUrl && !seen.has(absoluteUrl)) {
              discovered.push({
                url: absoluteUrl,
                source: 'pagination',
                priority: 8,
                discoveredFrom: baseUrl
              })
              seen.add(absoluteUrl)
            }
          }
        })
      })

      // Find career/jobs pages
      const careerPatterns = [
        'a[href*="/careers"]',
        'a[href*="/jobs"]',
        'a[href*="/opportunities"]',
        'a[href*="/work"]'
      ]

      careerPatterns.forEach(selector => {
        $(selector).each((i, elem) => {
          if (discovered.length < 10) {
            const href = $(elem).attr('href')
            if (href) {
              const absoluteUrl = this.resolveUrl(href, baseUrl)
              if (absoluteUrl && !seen.has(absoluteUrl)) {
                discovered.push({
                  url: absoluteUrl,
                  source: 'internal_link',
                  priority: 6,
                  discoveredFrom: baseUrl
                })
                seen.add(absoluteUrl)
              }
            }
          }
        })
      })

      return discovered.slice(0, 5) // Max 5 per page
    } catch (error) {
      console.warn('Page discovery error:', error)
      return []
    }
  }

  private resolveUrl(href: string, baseUrl: string): string | null {
    try {
      if (href.startsWith('http://') || href.startsWith('https://')) {
        return href
      }
      if (href.startsWith('/')) {
        const base = new URL(baseUrl)
        return `${base.protocol}//${base.host}${href}`
      }
      return new URL(href, baseUrl).toString()
    } catch {
      return null
    }
  }
}
