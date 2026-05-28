import axios from 'axios'
import { SearchResult, SearchOptions } from './interfaces.js'
import { RateLimiter } from './rate-limiter.js'

export class SearchService {
  private rateLimiter: RateLimiter
  private searxngUrl: string

  constructor(searxngUrl: string = 'http://localhost:8888') {
    this.searxngUrl = searxngUrl
    // Rate limit: 1 request per 2 seconds, max 1 concurrent request
    this.rateLimiter = new RateLimiter({ maxConcurrent: 1, delayMs: 2000 })
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const timeout = options.timeout || 10000
    const maxResults = options.maxResults || 15

    try {
      return await this.rateLimiter.execute(async () => {
        const response = await axios.get(this.searxngUrl, {
          params: {
            q: `${query} jobs`,
            format: 'json',
            engines: 'google',
            pageno: 1,
            results_on_page: maxResults
          },
          timeout
        })

        const results: SearchResult[] = (response.data.results || [])
          .slice(0, maxResults)
          .map((result: any) => ({
            url: result.url || '',
            title: result.title || '',
            snippet: result.content || result.snippet || '',
            relevanceScore: this.calculateRelevance(result.title || '', query)
          }))

        return results
      })
    } catch (error) {
      console.error(
        'SearXNG search failed:',
        error instanceof Error ? error.message : String(error)
      )
      return []
    }
  }

  calculateRelevance(title: string, query: string): number {
    const titleLower = title.toLowerCase()
    const queryTerms = query.toLowerCase().split(' ').filter(term => term.length > 0)

    if (queryTerms.length === 0) {
      return 0
    }

    const matchCount = queryTerms.filter(term => titleLower.includes(term)).length
    return Math.min(1, matchCount / queryTerms.length)
  }
}
