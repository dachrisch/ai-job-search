import axios from 'axios'
import { DiscoveredCompany } from '@job-search/shared'
import { callLLMJson } from '../ai/llm.js'
import { emitPipelineEvent } from '../utils/pipeline.js'
import { SSEManager } from '../utils/SSEManager.js'

interface SearXNGResult {
  title: string
  url: string
  content: string
  engine: string
}

interface CompanyClassification {
  url: string
  isCompanyPage: boolean
  companyName?: string | null
  hiddenGemScore: number
  sizeSignals: string[]
  sizeBand: 'small' | 'medium' | 'large' | 'unknown'
  confidence: 'high' | 'medium' | 'low'
}

interface QuerySuggestion {
  q: string
  intent: string
}

interface QueryPlan {
  queries: QuerySuggestion[]
}

const MAX_ROUNDS = 2
const QUERIES_PER_ROUND = 6
const PAGES_PER_QUERY = 3
const LIMIT_PER_PAGE = 20
const CLASSIFY_LIMIT = 50
const MIN_GEM_SCORE = 60
const SEARCH_CONCURRENCY = 3

export class SearchSourceManager {
  private searxngUrl: string
  private searxngToken: string
  private blocklist: string[]

  constructor() {
    this.searxngUrl = process.env.SEARXNG_URL || 'https://search.lehel.xyz'
    this.searxngToken = process.env.SEARXNG_TOKEN || ''
    this.blocklist = (process.env.JOB_AGGREGATOR_BLOCKLIST || '')
      .split(',')
      .filter(Boolean)
      .map(s => s.toLowerCase().trim())
  }

  /**
   * Hidden-gem discovery loop. An opencode agent proposes a diverse set of
   * SearXNG queries (biased toward small/medium companies and startups), the
   * backend executes them with pagination (big corporates own page 1; gems
   * sit deeper), the agent classifies and scores the pooled results, and a
   * bounded refinement round digs for more before the agent prioritizes the
   * final candidates for crawling.
   */
  async discoverCompanies(searchId: string, userQuery: string, sseManager?: SSEManager): Promise<DiscoveredCompany[]> {
    console.log('[discoverCompanies] Starting hidden-gem company discovery', {
      searchId,
      userQuery,
    })

    const allResults = new Map<string, SearXNGResult>()
    let previousPlan: QueryPlan | null = null

    for (let round = 1; round <= MAX_ROUNDS; round++) {
      await emitPipelineEvent(searchId, 'searxng_queries', 'query', `Generating SearXNG queries (round ${round}/${MAX_ROUNDS})`, undefined, { round }, sseManager)
      const plan = await this.generateQueries(userQuery, [...allResults.values()], previousPlan)
      previousPlan = plan
      await emitPipelineEvent(searchId, 'searxng_queries_result', 'result', `Generated ${plan.queries.length} queries`, plan.queries.map(q => q.q).join('\n'), { queries: plan.queries }, sseManager)
      const roundResults = await this.runQueries(plan.queries)
      await emitPipelineEvent(searchId, 'searxng_search_result', 'result', `Round ${round}: ${roundResults.length} results (${allResults.size} total)`, undefined, { round, roundResults: roundResults.length, total: allResults.size }, sseManager)
      for (const result of roundResults) {
        if (!allResults.has(result.url)) allResults.set(result.url, result)
      }
      console.log(`[discoverCompanies] Round ${round}: +${roundResults.length} results (${allResults.size} total)`)
      if (allResults.size >= CLASSIFY_LIMIT) break
    }

    if (allResults.size === 0) {
      console.warn('[discoverCompanies] SearXNG returned no results', { searchId, userQuery })
      return []
    }

    const candidates = [...allResults.values()].slice(0, CLASSIFY_LIMIT)
    await emitPipelineEvent(searchId, 'classification_start', 'info', `Classifying ${candidates.length} results with AI`, undefined, { count: candidates.length }, sseManager)
    const classifications = await this.classifyResults(candidates, userQuery)
    await emitPipelineEvent(searchId, 'classification_result', 'response', `Classification complete: ${classifications.filter(c => c.isCompanyPage).length} company pages found`, undefined, { total: classifications.length, companyPages: classifications.filter(c => c.isCompanyPage).length }, sseManager)

    const byUrl = new Map(candidates.map(c => [c.url, c]))
    const discovered = classifications
      .filter(c => c.isCompanyPage && byUrl.has(c.url))
      .map(c => {
        const result = byUrl.get(c.url)!
        return {
          url: c.url,
          name: c.companyName || this.extractDomain(c.url),
          title: result.title,
          snippet: result.content || '',
          confidence: c.confidence,
          hiddenGemScore: c.hiddenGemScore ?? 0,
          sizeSignals: c.sizeSignals || [],
          sizeBand: c.sizeBand || 'unknown',
        } as DiscoveredCompany
      })

    if (discovered.length === 0) {
      console.warn('[discoverCompanies] No company career pages identified', { searchId })
      return []
    }

    await emitPipelineEvent(searchId, 'prioritize_start', 'info', `Prioritizing ${discovered.length} companies with AI`, undefined, { count: discovered.length }, sseManager)
    const priority = await this.prioritize(discovered, userQuery)
    await emitPipelineEvent(searchId, 'prioritize_result', 'response', 'Prioritization complete', undefined, undefined, sseManager)
    const priorityIndex = new Map(priority.map((url, i) => [url, i]))
    discovered.sort((a, b) => (priorityIndex.get(a.url) ?? 999) - (priorityIndex.get(b.url) ?? 999))

    console.log(`[discoverCompanies] Discovery complete: ${discovered.length} companies`, {
      hiddenGems: discovered.filter(c => (c.hiddenGemScore ?? 0) >= MIN_GEM_SCORE).length,
    })

    return discovered
  }

  // ATS platforms host per-company job postings under their own domain
  // (e.g. job-boards.greenhouse.io/{company}/jobs/{id}). Normalize to the
  // company's job-board root so the crawler lands on the full listings page.
  private static readonly ATS_DOMAINS = [
    'greenhouse.io',
    'lever.co',
    'jobs.ashbyhq.com',
    'apply.workable.com',
    'personio.de',
    'softgarden.io',
  ]

  private async generateQueries(
    userQuery: string,
    seenResults: SearXNGResult[],
    previousPlan: QueryPlan | null
  ): Promise<QueryPlan> {
    const seenBlock = seenResults
      .slice(0, 20)
      .map((r, i) => `${i + 1}. ${r.title} — ${r.url}`)
      .join('\n')

    const prompt = `You are a job-discovery strategist whose goal is to uncover hidden-gem employers: smaller companies, startups, and niche employers that typically sit buried below big corporations in search results.

The user is looking for: "${userQuery}"

${
  previousPlan
    ? 'The previous round of queries already ran. Suggest DIFFERENT angles to surface more hidden gems, not the same queries again.'
    : 'Generate a diverse set of search queries to find them.'
}
${seenBlock ? `Already seen results (avoid repeating these exact sites):\n${seenBlock}` : ''}

Return ONLY valid JSON:
{
  "queries": [
    { "q": "search query string", "intent": "short rationale" }
  ]
}

Guidelines:
- Return exactly ${QUERIES_PER_ROUND} queries
- Mix German and English long-tail phrasings built around the user's search, e.g. "<query> stellenangebote", "<query> wir suchen", "<query> jobs Mittelstand", "<query> startup"
- Include direct ATS-domain searches such as "<query> site:jobs.ashbyhq.com", "<query> site:apply.workable.com", and greenhouse/lever/personio/softgarden job boards — startups and SMEs cluster on these platforms
- Add negative filters (e.g. -site:linkedin.com -site:indeed.com -site:stepstone.de -site:xing.com) to push down aggregators
- Bias toward queries that surface small/medium companies rather than global corporations`

    console.log('[generateQueries] Asking opencode for a query plan')
    return callLLMJson<QueryPlan>(prompt)
  }

  private async runQueries(queries: QuerySuggestion[]): Promise<SearXNGResult[]> {
    const tasks: Array<() => Promise<SearXNGResult[]>> = []
    for (const query of queries) {
      for (let page = 1; page <= PAGES_PER_QUERY; page++) {
        tasks.push(() => this.searchSearXNG(query.q, page))
      }
    }

    const resultLists = await this.mapWithConcurrency(tasks, SEARCH_CONCURRENCY)

    const seen = new Set<string>()
    const results: SearXNGResult[] = []
    for (const list of resultLists) {
      for (const result of list) {
        const url = this.normalizeCompanyUrl(result.url)
        if (this.isJobAggregator(url)) continue
        if (seen.has(url)) continue
        seen.add(url)
        results.push({ ...result, url })
      }
    }
    return results
  }

  private async searchSearXNG(query: string, page: number): Promise<SearXNGResult[]> {
    console.log('[searchSearXNG] Calling SearXNG', { query, page })
    const response = await axios.get(`${this.searxngUrl}/search`, {
      params: {
        q: query,
        tokens: this.searxngToken,
        format: 'json',
        limit: LIMIT_PER_PAGE,
        p: page,
      },
      timeout: 15000,
    })
    return (response.data.results || []) as SearXNGResult[]
  }

  private async classifyResults(
    results: SearXNGResult[],
    userQuery: string
  ): Promise<CompanyClassification[]> {
    const topResults = results.slice(0, CLASSIFY_LIMIT)

    const prompt = `You are analyzing search results to find company career pages, prioritizing hidden-gem employers — small and medium companies, startups, and niche employers — over big corporations.

The user searched for: "${userQuery} careers"

For each result below, determine:
1. isCompanyPage: is this a company's own career/jobs page (not a job aggregator, recruiter portal, or news article)?
2. companyName: the company name, or null
3. hiddenGemScore (0-100): how much of a hidden gem is this employer? HIGH for small/medium/startup companies (team-size mentions like "we are a team of X", founder-led language, lesser-known brands, .de/.gmbh/.io/.dev domains, no Wikipedia presence). LOW for big corporations (global leader, Fortune 500, multinational, widely known brands).
4. sizeSignals: the concrete signals you used, as an array of short strings
5. sizeBand: "small" | "medium" | "large" | "unknown"
6. confidence: "high" | "medium" | "low"

Results:
${topResults
  .map(
    (r, i) => `- "${r.title}" at ${r.url}\n  Snippet: ${r.content?.substring(0, 120) || '(no snippet)'}`
  )
  .join('\n')}

Return ONLY a valid JSON array, one entry per result, in the same order:
[
  {
    "url": "string",
    "isCompanyPage": boolean,
    "companyName": "string or null",
    "hiddenGemScore": number,
    "sizeSignals": ["string"],
    "sizeBand": "small" | "medium" | "large" | "unknown",
    "confidence": "high" | "medium" | "low"
  }
]`

    console.log('[classifyResults] Asking opencode to classify results', {
      resultCount: topResults.length,
    })
    return callLLMJson<CompanyClassification[]>(prompt)
  }

  private async prioritize(
    companies: DiscoveredCompany[],
    userQuery: string
  ): Promise<string[]> {
    const prompt = `Rank these discovered companies by how likely they are to have high-quality job offers relevant to the user's search: "${userQuery}".
Prioritize hidden gems (higher hiddenGemScore, smaller sizeBand) while keeping relevance to the search in mind.

Companies:
${companies
  .map(
    (c, i) =>
      `${i + 1}. ${c.name} (${c.url}) — hiddenGemScore ${c.hiddenGemScore ?? '?'}, sizeBand ${c.sizeBand ?? 'unknown'}, confidence ${c.confidence}`
  )
  .join('\n')}

Return ONLY a valid JSON array of URLs, in the order you would crawl them (best first):
["https://example.com/careers", "..."]`

    console.log('[prioritize] Asking opencode to prioritize companies', {
      companyCount: companies.length,
    })
    return callLLMJson<string[]>(prompt)
  }

  private isJobAggregator(url: string): boolean {
    try {
      const domain = new URL(url).hostname.toLowerCase()
      return this.blocklist.some(blocked => domain.includes(blocked))
    } catch {
      return false
    }
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

  private async mapWithConcurrency<T>(tasks: Array<() => Promise<T>>, concurrency: number): Promise<T[]> {
    const results: T[] = new Array(tasks.length)
    let nextIndex = 0

    async function worker(): Promise<void> {
      while (true) {
        const index = nextIndex++
        if (index >= tasks.length) return
        results[index] = await tasks[index]()
      }
    }

    const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker())
    await Promise.all(workers)
    return results
  }
}

// Note: SearchSourceManager instances are stateless per request — no API key
// is needed anymore since opencode is configured globally via env vars.