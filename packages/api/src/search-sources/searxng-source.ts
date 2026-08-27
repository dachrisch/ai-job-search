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
  relevantToSearch: boolean
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

// Queries whose results land almost entirely on these domains are off-topic
// (dictionaries, wikis, definitions) — a symptom of the LLM emitting broken
// query syntax. Used to drop those results before classification.
const OFF_TOPIC_DOMAINS = new Set([
  'wikipedia.org', 'wiktionary.org', 'wikiwand.com',
  'pons.com', 'dict.cc', 'leo.org',
  'dictionary.cambridge.org', 'cambridge.org', 'merriam-webster.com',
  'oxfordlearnersdictionaries.com', 'collinsdictionary.com',
  'producthunt.com', 'techcrunch.com', 'reddit.com', 'youtube.com',
])

// If discovery yields too few usable results (e.g. every generated query was
// malformed and returned dictionary junk), fall back to these simple,
// deterministic queries built from the user's own search so the pipeline still
// has something real to classify.
const MIN_RESULTS_BEFORE_FALLBACK = 5

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

    // Guard: if the LLM produced only broken queries (few/no usable results),
    // fall back to simple deterministic queries so we still surface real jobs
    // instead of failing the whole search.
    if (allResults.size < MIN_RESULTS_BEFORE_FALLBACK) {
      console.warn('[discoverCompanies] Too few results from generated queries, using fallback queries', {
        size: allResults.size,
        userQuery,
      })
      const fallback: QuerySuggestion[] = [
        `${userQuery} site:greenhouse.io`,
        `${userQuery} site:jobs.ashbyhq.com`,
        `${userQuery} site:personio.com`,
      ].map(q => ({ q: this.sanitizeQuery(q), intent: 'fallback' }))
      const fbResults = await this.runQueries(fallback)
      for (const r of fbResults) {
        if (!allResults.has(r.url)) allResults.set(r.url, r)
      }
    }

    if (allResults.size === 0) {
      console.warn('[discoverCompanies] SearXNG returned no results', { searchId, userQuery })
      return []
    }

    const candidates = [...allResults.values()].slice(0, CLASSIFY_LIMIT)
    await emitPipelineEvent(searchId, 'classification_start', 'info', `Classifying ${candidates.length} results with AI`, undefined, { count: candidates.length }, sseManager)
    const classifications = await this.classifyResults(candidates, userQuery)
    const companyPages = classifications.filter(c => c.isCompanyPage).length
    const relevant = classifications.filter(c => c.isCompanyPage && c.relevantToSearch !== false).length
    await emitPipelineEvent(searchId, 'classification_result', 'response', `Classification complete: ${companyPages} company pages found, ${relevant} relevant to search`, undefined, { total: classifications.length, companyPages, relevant }, sseManager)

    const byUrl = new Map(candidates.map(c => [c.url, c]))
    const discovered = classifications
      .filter(c => c.isCompanyPage && c.relevantToSearch !== false && byUrl.has(c.url))
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
    - Return exactly ${QUERIES_PER_ROUND} queries.
    - Output clean, valid search syntax. Never wrap a query in stray parentheses or quotes (e.g. avoid artifacts like '(")Software Engineer"'). Each query must be a single coherent search string — no unbalanced quotes or parentheses.
    - PRIMARY STRATEGY (the crawler can only extract jobs from ATS-hosted boards, NOT from company-owned career pages): make MOST queries target a single ATS job board with the role + location. Use exactly ONE site: filter per query — never chain multiple with OR. Vary the board across queries, e.g.:
      * "<role> <location> site:greenhouse.io"
      * "<role> <location> site:jobs.ashbyhq.com"
      * "<role> <location> site:personio.com"
      * "<role> <location> site:apply.workable.com"
      * "<role> <location> site:jobs.lever.co"
      * "<role> <location> site:softgarden.de"
    - VARY THE JOB TITLE: use local-language and English variants plus seniority/specialization variants (e.g. "Product Manager" → "Produktmanager", "Product Owner"; "Software Engineer" → "Softwareentwickler", "Backend Engineer"). Always keep the location on these variant queries too.
    - PRESERVE GEOGRAPHY: the location MUST appear in every query. When a location is given, also use metro-area/region synonyms in separate queries (e.g. "München" → "Großraum München", "Bayern", "Oberbayern"; "Munich" → "Greater Munich", "Bavaria").
    - Add negative filters (e.g. -site:linkedin.com -site:indeed.com -site:stepstone.de -site:xing.com) to push down aggregators.
    - Do NOT use phrases like "wir suchen" or "join our team" — they match unrelated pages.
    - Keep one or two generic "<role> <location> stellenangebote" queries only as a fallback.
    - Bias toward queries that surface small/medium companies and startups (which cluster on these ATS boards) rather than global corporations.`

    console.log('[generateQueries] Asking opencode for a query plan')
    const plan = await callLLMJson<QueryPlan>(prompt)
    // The small/free LLM occasionally emits malformed query syntax (e.g. the
    // `(")..."` artifact). Strip that before we ever hit SearXNG.
    for (const q of plan.queries) q.q = this.sanitizeQuery(q.q)
    return plan
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
        if (this.isOffTopic(url)) continue
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
1. isCompanyPage: is this a company's own career/jobs page (not a pure job aggregator like Stepstone/Indeed/LinkedIn/Xing, not a recruiter portal, not a news article)? Pages hosted on ATS platforms ARE valid company career pages — e.g. job-boards.greenhouse.io/<company>, jobs.lever.co/<company>, <company>.jobs.personio.de, jobs.ashbyhq.com/<company>, apply.workable.com/<company>, *.softgarden.de. Accept these.
2. relevantToSearch: does this company plausibly offer roles matching the user's search AND operate in/near the specified location? Be STRICT. Reject companies in a different city/country or an unrelated industry, even if they have a careers page (e.g. a Seattle restaurant is NOT relevant to "product manager munich").
3. companyName: the company name, or null
4. hiddenGemScore (0-100): how much of a hidden gem is this employer? HIGH for small/medium/startup companies (team-size mentions like "we are a team of X", founder-led language, lesser-known brands, .de/.gmbh/.io/.dev domains, no Wikipedia presence). LOW for big corporations (global leader, Fortune 500, multinational, widely known brands).
5. sizeSignals: the concrete signals you used, as an array of short strings
6. sizeBand: "small" | "medium" | "large" | "unknown"
7. confidence: "high" | "medium" | "low"

Only mark a result as a useful discovery if BOTH isCompanyPage AND relevantToSearch are true.

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
    "relevantToSearch": boolean,
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

  /**
   * Clean a generated query into valid SearXNG syntax. The small/free LLM
   * sometimes emits artifacts like `(")Product Manager"` (stray parens/quotes)
   * or doubled quotes; these break retrieval and return dictionary junk. We
   * strip parens (SearXNG needs none for OR/`site:`) and collapse quotes.
   */
  private sanitizeQuery(q: string): string {
    return q
      .replace(/[()]/g, '')
      .replace(/"{2,}/g, '"')
      .replace(/\s+/g, ' ')
      .trim()
  }

  private isOffTopic(url: string): boolean {
    try {
      const domain = new URL(url).hostname.toLowerCase().replace(/^www\./, '')
      return OFF_TOPIC_DOMAINS.has(domain)
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
      if (!isAtsHost) {
        // Drop tracking/query params (e.g. ?msockid=) so the same page isn't
        // discovered as multiple "companies" and so we crawl the stable root.
        // Preserve the original formatting (no re-serialization, which would
        // add trailing slashes and break URL matching in classification).
        return url.split(/[?#]/)[0]
      }

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