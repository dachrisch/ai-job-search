import axios from 'axios'
import { DiscoveredCompany } from '@job-search/shared'
import { buildAnthropicClient } from '../claude/auth.js'

interface SearXNGResult {
  title: string
  url: string
  content: string
  engine: string
}

interface ValidationResult {
  url: string
  isCompanyPage: boolean
  companyName?: string | null
  confidence: 'high' | 'medium' | 'low'
}

export class SearchSourceManager {
  private searxngUrl: string
  private searxngToken: string
  private blocklist: string[]
  private anthropic: ReturnType<typeof buildAnthropicClient>

  constructor(claudeApiKey: string) {
    this.searxngUrl = process.env.SEARXNG_URL || 'https://search.lehel.xyz'
    this.searxngToken = process.env.SEARXNG_TOKEN || ''
    this.blocklist = (process.env.JOB_AGGREGATOR_BLOCKLIST || '')
      .split(',')
      .filter(Boolean)
      .map(s => s.toLowerCase().trim())
    this.anthropic = buildAnthropicClient(claudeApiKey)
  }

  async discoverCompanies(
    searchId: string,
    userQuery: string
  ): Promise<DiscoveredCompany[]> {
    try {
      console.log('[discoverCompanies] Starting company discovery', {
        searchId,
        userQuery
      })

      // Step 1: Search SearXNG
      const searchResults = await this.searchSearXNG(userQuery)

      if (!searchResults.length) {
        console.warn('[discoverCompanies] SearXNG returned no results', {
          searchId,
          userQuery
        })
        return []
      }

      console.log('[discoverCompanies] SearXNG results received', {
        searchId,
        resultCount: searchResults.length
      })

      // Step 2: Filter aggregators
      let filteredResults = searchResults.filter(
        r => !this.isJobAggregator(r.url)
      )

      if (!filteredResults.length) {
        console.warn('[discoverCompanies] All results were job aggregators', {
          searchId
        })
        return []
      }

      // ATS platforms (Greenhouse/Lever/Ashby) return individual job-posting
      // URLs from search results. Normalize to the company's job-board root
      // so the crawler lands on the full listings page instead of one post,
      // and dedupe since multiple postings from the same company collapse
      // to the same root URL.
      const seenUrls = new Set<string>()
      filteredResults = filteredResults
        .map(r => ({ ...r, url: this.normalizeCompanyUrl(r.url) }))
        .filter(r => {
          if (seenUrls.has(r.url)) return false
          seenUrls.add(r.url)
          return true
        })

      console.log('[discoverCompanies] After aggregator filter', {
        searchId,
        remaining: filteredResults.length
      })

      // Step 3: Validate with LLM
      const validations = await this.validateWithLLM(
        filteredResults,
        userQuery
      )

      console.log('[discoverCompanies] LLM validation complete', {
        searchId,
        validationCount: validations.length
      })

      // Step 4: Merge and return
      const discovered = filteredResults
        .map((result, i) => {
          const validation = validations[i]
          if (!validation?.isCompanyPage) return null

          return {
            url: result.url,
            name: validation.companyName || this.extractDomain(result.url),
            title: result.title,
            snippet: result.content,
            confidence: validation.confidence
          }
        })
        .filter(Boolean) as DiscoveredCompany[]

      console.log('[discoverCompanies] Company discovery complete', {
        searchId,
        companiesFound: discovered.length
      })

      return discovered
    } catch (error) {
      console.error('[discoverCompanies] Company discovery failed', {
        searchId,
        error: error instanceof Error ? error.message : String(error)
      })
      throw error
    }
  }

  // ATS platforms host per-company job postings under their own domain
  // (e.g. job-boards.greenhouse.io/{company}/jobs/{id}). Generic "<query>
  // careers" searches are dominated by aggregators (LinkedIn, Indeed), so we
  // also search these ATS domains directly to surface individual companies.
  private static readonly ATS_DOMAINS = [
    'greenhouse.io',
    'lever.co',
    'jobs.ashbyhq.com'
  ]

  private async searchSearXNG(query: string): Promise<SearXNGResult[]> {
    const searchQueries = [
      `${query} careers`,
      ...SearchSourceManager.ATS_DOMAINS.map(domain => `${query} jobs site:${domain}`)
    ]

    const resultLists = await Promise.all(
      searchQueries.map(searchQuery => {
        console.log('[searchSearXNG] Calling SearXNG', { query: searchQuery })
        return axios
          .get(`${this.searxngUrl}/search`, {
            params: {
              q: searchQuery,
              tokens: this.searxngToken,
              format: 'json',
              limit: 30
            },
            timeout: 15000
          })
          .then(response => (response.data.results || []) as SearXNGResult[])
      })
    )

    const seen = new Set<string>()
    return resultLists.flat().filter(result => {
      if (seen.has(result.url)) return false
      seen.add(result.url)
      return true
    })
  }

  private isJobAggregator(url: string): boolean {
    try {
      const domain = new URL(url).hostname.toLowerCase()
      return this.blocklist.some(blocked => domain.includes(blocked))
    } catch {
      return false
    }
  }

  private async validateWithLLM(
    results: SearXNGResult[],
    userQuery: string
  ): Promise<ValidationResult[]> {
    const topResults = results.slice(0, 40)

    const prompt = `You are an expert at identifying company career pages from search results.

User searched for: "${userQuery} careers"

Below are search results. For each, determine if it's a company career page (not a job aggregator or recruiter site).
Return ONLY a valid JSON array with no markdown, no explanation.

${topResults
  .map(
    r =>
      `- "${r.title}" at ${r.url}\n  Snippet: ${r.content?.substring(0, 100) || '(no snippet)'}`
  )
  .join('\n')}

Return exactly this JSON format:
[
  {
    "url": "string",
    "isCompanyPage": boolean,
    "companyName": "string or null",
    "confidence": "high" | "medium" | "low"
  }
]`

    console.log('[validateWithLLM] Calling Claude for validation', {
      resultCount: topResults.length
    })

    const response = await this.anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    })

    const text =
      response.content[0].type === 'text' ? response.content[0].text : ''

    // Extract JSON array
    const match = text.match(/\[[\s\S]*\]/)
    if (!match) {
      console.warn('[validateWithLLM] LLM did not return valid JSON', {
        text: text.substring(0, 200)
      })
      return []
    }

    return JSON.parse(match[0]) as ValidationResult[]
  }

  // Trims ATS job-posting URLs down to the company's job-board root, e.g.
  // job-boards.greenhouse.io/getyourguide/jobs/123 -> .../getyourguide
  private normalizeCompanyUrl(url: string): string {
    try {
      const u = new URL(url)
      const isAtsHost = SearchSourceManager.ATS_DOMAINS.some(domain =>
        u.hostname.endsWith(domain)
      )
      if (!isAtsHost) return url

      const firstSegment = u.pathname.split('/').filter(Boolean)[0]
      if (!firstSegment) return url

      return `${u.protocol}//${u.host}/${firstSegment}`
    } catch {
      return url
    }
  }

  private extractDomain(url: string): string {
    try {
      return new URL(url).hostname.replace('www.', '')
    } catch {
      return url
    }
  }
}

// Note: SearchSourceManager instances are created per request with user's Claude API key
// Do not create a default singleton instance
