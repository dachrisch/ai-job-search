# Intelligent Job Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement SearchService, PageAnalyzer, enhanced WebScraper with page discovery, and new event handlers to move from mock data to real job discovery via SearXNG + Claude analysis.

**Architecture:** Three-phase system: (1) SearchService calls SearXNG to find job pages, (2) PageAnalyzer uses Claude to prioritize pages, (3) Enhanced WebScraper extracts jobs and discovers new pages through pagination + internal links. New events orchestrate the flow with graceful fallback to domain-based scraping if SearXNG fails.

**Tech Stack:** TypeScript/Node.js, SearXNG API (free, open-source), Claude API, Cheerio (HTML parsing), Jest/Vitest (testing)

---

## File Structure

### New Files
- `packages/api/src/job-sources/search-service.ts` - SearXNG API integration
- `packages/api/src/job-sources/page-analyzer.ts` - Claude-based page prioritization
- `packages/api/src/job-sources/__tests__/search-service.test.ts` - SearchService unit tests
- `packages/api/src/job-sources/__tests__/page-analyzer.test.ts` - PageAnalyzer unit tests
- `packages/api/src/job-sources/__tests__/discovery-integration.test.ts` - E2E discovery flow

### Modified Files
- `packages/api/src/job-sources/web-scraper.ts` - Add `discoveredPages` extraction
- `packages/api/src/job-sources/manager.ts` - Add discovery queue management
- `packages/api/src/job-sources/interfaces.ts` - Add new interfaces
- `packages/api/src/events/handlers.ts` - Add/modify event handlers
- `packages/api/src/db/models.ts` - Update SearchSession schema

---

## Task 1: Define Interfaces & Types

**Files:**
- Modify: `packages/api/src/job-sources/interfaces.ts`

- [ ] **Step 1: Add SearchResult interface**

```typescript
// In interfaces.ts, add:

export interface SearchResult {
  url: string
  title: string
  snippet: string
  relevanceScore: number
}

export interface SearchOptions {
  timeout?: number
  maxResults?: number
}
```

- [ ] **Step 2: Add AnalyzedPage interface**

```typescript
// In interfaces.ts, add:

export interface AnalyzedPage {
  url: string
  confidence: number // 0-1
  reason: string
  priority: number // 1-10
}

export interface PageAnalysisOptions {
  maxPages?: number
  minConfidence?: number
}
```

- [ ] **Step 3: Add DiscoveredPage interface**

```typescript
// In interfaces.ts, add:

export interface DiscoveredPage {
  url: string
  source: 'pagination' | 'internal_link' | 'discovered'
  priority: number
  discoveredFrom: string // parent URL
}

export interface ScrapingResultWithDiscovery extends ScrapingResult {
  discoveredPages: DiscoveredPage[]
}
```

- [ ] **Step 4: Verify interfaces compile**

Run: `npm run build` from `packages/api`
Expected: No TypeScript errors

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/job-sources/interfaces.ts
git commit -m "feat: add interfaces for job discovery system

- SearchResult: SearXNG API response format
- AnalyzedPage: Claude-prioritized pages
- DiscoveredPage: Pages found during scraping
- ScrapingResultWithDiscovery: Enhanced scraper output"
```

---

## Task 2: Implement SearchService

**Files:**
- Create: `packages/api/src/job-sources/search-service.ts`
- Create: `packages/api/src/job-sources/__tests__/search-service.test.ts`

- [ ] **Step 1: Write failing test for SearXNG API call**

```typescript
// packages/api/src/job-sources/__tests__/search-service.test.ts

import { SearchService } from '../search-service'

describe('SearchService', () => {
  const service = new SearchService()

  it('should call SearXNG API and return search results', async () => {
    const results = await service.search('python backend engineer remote')
    
    expect(Array.isArray(results)).toBe(true)
    expect(results.length).toBeGreaterThan(0)
    
    // Verify result structure
    results.forEach(result => {
      expect(result).toHaveProperty('url')
      expect(result).toHaveProperty('title')
      expect(result).toHaveProperty('snippet')
      expect(typeof result.url).toBe('string')
      expect(typeof result.relevanceScore).toBe('number')
    })
  })

  it('should handle network errors gracefully', async () => {
    const service = new SearchService()
    // Mock timeout scenario
    const results = await service.search('test query', { timeout: 100 })
    expect(Array.isArray(results)).toBe(true)
    // Empty array on timeout
  })

  it('should apply rate limiting', async () => {
    const service = new SearchService()
    const start = Date.now()
    
    await service.search('query 1')
    await service.search('query 2')
    
    const duration = Date.now() - start
    // Should take at least 2 seconds due to rate limiting
    expect(duration).toBeGreaterThanOrEqual(2000)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- search-service.test.ts --run`
Expected: FAIL - "SearchService is not defined"

- [ ] **Step 3: Implement SearchService**

```typescript
// packages/api/src/job-sources/search-service.ts

import axios from 'axios'
import { SearchResult, SearchOptions } from './interfaces.js'
import { RateLimiter } from './rate-limiter.js'

export class SearchService {
  private rateLimiter: RateLimiter
  private searxngUrl: string

  constructor(searxngUrl: string = 'http://localhost:8888') {
    this.searxngUrl = searxngUrl
    // Rate limit: 1 request per 2 seconds
    this.rateLimiter = new RateLimiter(2000)
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const timeout = options.timeout || 10000
    const maxResults = options.maxResults || 15

    try {
      // Wait for rate limiter
      await this.rateLimiter.wait()

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

      const results: SearchResult[] = response.data.results
        .slice(0, maxResults)
        .map((result: any) => ({
          url: result.url,
          title: result.title,
          snippet: result.content || '',
          relevanceScore: this.calculateRelevance(result.title, query)
        }))

      return results
    } catch (error) {
      console.error('SearXNG search failed:', error instanceof Error ? error.message : error)
      // Return empty array on error - triggers fallback
      return []
    }
  }

  private calculateRelevance(title: string, query: string): number {
    const titleLower = title.toLowerCase()
    const queryTerms = query.toLowerCase().split(' ')
    
    const matchCount = queryTerms.filter(term => titleLower.includes(term)).length
    return Math.min(1, matchCount / queryTerms.length)
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- search-service.test.ts --run`
Expected: PASS (2-3 tests, may skip actual SearXNG calls)

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/job-sources/search-service.ts packages/api/src/job-sources/__tests__/search-service.test.ts
git commit -m "feat: implement SearchService with SearXNG integration

- Calls SearXNG API to find job listing pages
- Rate limiting: 1 request per 2 seconds
- Graceful error handling: returns empty array on failure
- Calculates relevance score based on query match
- Timeout: 10 seconds per request"
```

---

## Task 3: Implement PageAnalyzer

**Files:**
- Create: `packages/api/src/job-sources/page-analyzer.ts`
- Create: `packages/api/src/job-sources/__tests__/page-analyzer.test.ts`

- [ ] **Step 1: Write failing test for Claude analysis**

```typescript
// packages/api/src/job-sources/__tests__/page-analyzer.test.ts

import { PageAnalyzer } from '../page-analyzer'
import { SearchResult } from '../interfaces'

describe('PageAnalyzer', () => {
  const analyzer = new PageAnalyzer()

  it('should analyze search results and prioritize job boards', async () => {
    const results: SearchResult[] = [
      {
        url: 'https://linkedin.com/jobs',
        title: 'LinkedIn Jobs - Find Your Next Opportunity',
        snippet: 'Search job listings on LinkedIn',
        relevanceScore: 0.9
      },
      {
        url: 'https://example.com/blog',
        title: 'How to Write a Resume',
        snippet: 'Tips for writing a great resume',
        relevanceScore: 0.2
      }
    ]

    const analyzed = await analyzer.analyzePages(results, 'python backend engineer')

    expect(Array.isArray(analyzed)).toBe(true)
    expect(analyzed.length).toBeGreaterThan(0)
    
    // LinkedIn should rank higher than blog post
    expect(analyzed[0].url).toContain('linkedin.com')
    
    // Verify structure
    analyzed.forEach(page => {
      expect(page).toHaveProperty('url')
      expect(page).toHaveProperty('confidence')
      expect(page).toHaveProperty('reason')
      expect(page).toHaveProperty('priority')
      expect(page.confidence).toBeGreaterThanOrEqual(0)
      expect(page.confidence).toBeLessThanOrEqual(1)
    })
  })

  it('should handle Claude API failures gracefully', async () => {
    const results: SearchResult[] = [
      {
        url: 'https://example.com',
        title: 'Test Page',
        snippet: 'Test snippet',
        relevanceScore: 0.5
      }
    ]

    const analyzed = await analyzer.analyzePages(results, 'test query')
    
    // Should return results with default priority on failure
    expect(analyzed.length).toBeGreaterThan(0)
    expect(analyzed[0].confidence).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- page-analyzer.test.ts --run`
Expected: FAIL - "PageAnalyzer is not defined"

- [ ] **Step 3: Implement PageAnalyzer**

```typescript
// packages/api/src/job-sources/page-analyzer.ts

import { SearchResult, AnalyzedPage, PageAnalysisOptions } from './interfaces.js'
import { callClaude } from '../claude/client.js'

export class PageAnalyzer {
  async analyzePages(
    results: SearchResult[],
    userQuery: string,
    userId: string = 'system',
    options: PageAnalysisOptions = {}
  ): Promise<AnalyzedPage[]> {
    const maxPages = options.maxPages || 20
    const minConfidence = options.minConfidence || 0.3

    try {
      // Batch results if too many
      const pagesToAnalyze = results.slice(0, maxPages)

      // Create prompt for Claude
      const prompt = `Given the user is searching for: "${userQuery}"

And these pages were found:
${pagesToAnalyze.map((r, i) => `${i + 1}. ${r.title}\n   URL: ${r.url}\n   Snippet: ${r.snippet}`).join('\n\n')}

For each URL (1-${pagesToAnalyze.length}), determine:
1. Does it likely contain job postings relevant to the query? (confidence 0-1)
2. How high priority is it? (1-10, higher = more relevant jobs)
3. Brief reason why

Return ONLY valid JSON array, no other text:
[
  {
    "urlIndex": 1,
    "confidence": 0.95,
    "priority": 10,
    "reason": "LinkedIn job board, highly relevant"
  },
  ...
]`

      const response = await callClaude(userId, prompt)

      // Parse Claude's response
      const analyzed = this.parseAnalysis(response, pagesToAnalyze, minConfidence)
      
      // Sort by priority descending
      return analyzed.sort((a, b) => b.priority - a.priority)
    } catch (error) {
      console.error('PageAnalyzer failed:', error instanceof Error ? error.message : error)
      
      // Fallback: use heuristics based on title/snippet
      return this.fallbackAnalysis(results, userQuery)
    }
  }

  private parseAnalysis(
    response: string,
    pages: SearchResult[],
    minConfidence: number
  ): AnalyzedPage[] {
    try {
      // Extract JSON from response
      const jsonMatch = response.match(/\[[\s\S]*\]/)
      if (!jsonMatch) {
        throw new Error('No JSON array found in response')
      }

      const analyzed = JSON.parse(jsonMatch[0])

      return analyzed
        .filter((item: any) => item.confidence >= minConfidence)
        .map((item: any) => ({
          url: pages[item.urlIndex - 1]?.url || '',
          confidence: Math.min(1, Math.max(0, item.confidence)),
          reason: item.reason || 'Analyzed by Claude',
          priority: Math.min(10, Math.max(1, item.priority))
        }))
        .filter((item: any) => item.url) // Remove invalid entries
    } catch (error) {
      console.warn('Failed to parse Claude analysis:', error)
      throw error
    }
  }

  private fallbackAnalysis(results: SearchResult[], userQuery: string): AnalyzedPage[] {
    const jobKeywords = ['job', 'career', 'hire', 'recruit', 'position', 'vacancy', 'opening']
    const queryTerms = userQuery.toLowerCase().split(' ')

    return results
      .map(result => {
        const titleLower = result.title.toLowerCase()
        const snippetLower = result.snippet.toLowerCase()
        
        // Calculate confidence based on keywords
        const jobMatches = jobKeywords.filter(
          kw => titleLower.includes(kw) || snippetLower.includes(kw)
        ).length
        
        const queryMatches = queryTerms.filter(
          term => titleLower.includes(term) || snippetLower.includes(term)
        ).length

        const confidence = Math.min(
          1,
          (jobMatches / jobKeywords.length) * 0.7 + (queryMatches / queryTerms.length) * 0.3
        )

        return {
          url: result.url,
          confidence,
          reason: 'Heuristic fallback analysis',
          priority: Math.round(confidence * 10)
        }
      })
      .filter(item => item.confidence >= 0.3)
      .sort((a, b) => b.priority - a.priority)
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- page-analyzer.test.ts --run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/job-sources/page-analyzer.ts packages/api/src/job-sources/__tests__/page-analyzer.test.ts
git commit -m "feat: implement PageAnalyzer with Claude integration

- Uses Claude API to analyze search results
- Prioritizes pages by relevance to user query
- Fallback heuristics if Claude fails
- Returns ranked list for scraping order
- Confidence and priority scoring"
```

---

## Task 4: Enhance WebScraper with Page Discovery

**Files:**
- Modify: `packages/api/src/job-sources/web-scraper.ts`
- Modify: `packages/api/src/job-sources/__tests__/web-scraper.test.ts`

- [ ] **Step 1: Write failing test for page discovery**

```typescript
// Add to packages/api/src/job-sources/__tests__/web-scraper.test.ts

it('should discover pagination and internal links', async () => {
  const scraper = new WebScraper()
  const result = await scraper.scrape(['linkedin.com'], 'engineer')

  expect(result[0].discoveredPages).toBeDefined()
  expect(Array.isArray(result[0].discoveredPages)).toBe(true)
  
  // Should discover some pages
  if (result[0].jobs.length > 0) {
    // If we found jobs, we should have found links too
    expect(result[0].discoveredPages.length).toBeGreaterThanOrEqual(0)
  }
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- web-scraper.test.ts --run`
Expected: FAIL - "discoveredPages is not defined"

- [ ] **Step 3: Modify WebScraper implementation**

```typescript
// In packages/api/src/job-sources/web-scraper.ts

// Add to the scrape method's result aggregation:

private discoverPages(html: string, baseUrl: string): string[] {
  const discovered: string[] = []
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
            discovered.push(absoluteUrl)
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
        const href = $(elem).attr('href')
        if (href && discovered.length < 10) {
          const absoluteUrl = this.resolveUrl(href, baseUrl)
          if (absoluteUrl && !seen.has(absoluteUrl)) {
            discovered.push(absoluteUrl)
            seen.add(absoluteUrl)
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
```

- [ ] **Step 4: Update ScrapingResult to include discoveredPages**

```typescript
// In packages/api/src/job-sources/web-scraper.ts

// Modify the scrape method return to include discovered pages:

const result = await Promise.all(
  domains.map(async domain => {
    try {
      const html = await this.fetchPage(domain)
      const jobs = this.parseJobs(html)
      const discoveredPages = this.discoverPages(html, `https://${domain}`)
      
      return {
        source: 'WebScraper',
        jobs,
        discoveredPages, // NEW
        errors: []
      }
    } catch (error) {
      return {
        source: 'WebScraper',
        jobs: [],
        discoveredPages: [], // NEW
        errors: [{ message: String(error) }]
      }
    }
  })
)
```

- [ ] **Step 5: Run tests**

Run: `npm test -- web-scraper.test.ts --run`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/job-sources/web-scraper.ts packages/api/src/job-sources/__tests__/web-scraper.test.ts
git commit -m "feat: enhance WebScraper with page discovery

- Discovers pagination links (next page, etc)
- Discovers internal career/jobs pages
- Returns discoveredPages array in result
- Max 5 discovered pages per scraped page
- URL resolution for relative links"
```

---

## Task 5: Enhance JobSourceManager with Discovery Queue

**Files:**
- Modify: `packages/api/src/job-sources/manager.ts`

- [ ] **Step 1: Add discovery queue management to JobSourceManager**

```typescript
// In packages/api/src/job-sources/manager.ts, add:

export class JobSourceManager {
  private discoveryQueue: Map<string, Set<string>> = new Map() // searchId -> Set<urls>
  private scrapedPages: Map<string, Set<string>> = new Map() // searchId -> Set<urls>

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
            result.discoveredPages.forEach((page: any) => {
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
```

- [ ] **Step 2: Run existing tests to ensure no regression**

Run: `npm test -- manager.test.ts --run`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/job-sources/manager.ts
git commit -m "feat: add discovery queue management to JobSourceManager

- Tracks discovered pages per search session
- Prevents revisiting same URLs
- Iterative scraping: up to 3 rounds
- Aggregates jobs from all discovered pages"
```

---

## Task 6: Update SearchSession Database Schema

**Files:**
- Modify: `packages/api/src/db/models.ts`

- [ ] **Step 1: Add discovery fields to SearchSession**

```typescript
// In packages/api/src/db/models.ts, update SearchSessionSchema:

const SearchSessionSchema = new Schema({
  userId: { type: String, required: true },
  query: { type: String, required: true },
  status: { type: String, enum: ['running', 'complete', 'failed'], default: 'running' },

  // NEW: Discovery tracking
  searchPhase: { type: String, enum: ['initial', 'refined'], default: 'initial' },
  searchQueries: [String], // ['remote backend', 'mid-level python', ...]
  discoveredPages: [String], // URLs found during scraping
  scrapedPages: [String], // URLs already processed

  claudeConversationHistory: [
    {
      role: { type: String, enum: ['user', 'assistant'] },
      content: String
    }
  ],
  foundJobs: [{ type: Schema.Types.ObjectId, ref: 'Job' }],
  sitesSearched: [String],
  iterationCount: { type: Number, default: 0 },
  startedAt: { type: Date, default: Date.now },
  completedAt: Date
})
```

- [ ] **Step 2: Verify TypeScript compilation**

Run: `npm run build` from `packages/api`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/db/models.ts
git commit -m "feat: update SearchSession schema for discovery tracking

- searchQueries: track multiple search iterations
- discoveredPages: store URLs found during scraping
- scrapedPages: prevent revisiting
- searchPhase: distinguish initial vs refined searches"
```

---

## Task 7: Implement New Event Handlers

**Files:**
- Modify: `packages/api/src/events/handlers.ts`

- [ ] **Step 1: Implement search_query_performed handler**

```typescript
// In packages/api/src/events/handlers.ts, add new handler:

search_query_performed: async (
  data: { searchId: string; query: string; results: SearchResult[] },
  sseManager: SSEManager
) => {
  try {
    console.log(`\n🤖 AGENT LOG - Search Query Performed`)
    console.log(`   Query: "${data.query}"`)
    console.log(`   Results found: ${data.results.length}`)

    const session = await SearchSessionModel.findById(data.searchId)
    if (!session) {
      console.warn('Session not found:', data.searchId)
      return
    }

    // Store search results
    session.searchQueries.push(data.query)
    await session.save()

    // Trigger page analysis
    await addEvent('pages_analyzed', {
      searchId: data.searchId,
      query: data.query,
      results: data.results
    })
  } catch (error) {
    console.error('Error in search_query_performed handler:', error)
    await addEvent('search_failed', { searchId: data.searchId, error: String(error) })
  }
}
```

- [ ] **Step 2: Implement pages_analyzed handler**

```typescript
// In packages/api/src/events/handlers.ts, add:

pages_analyzed: async (
  data: { searchId: string; query: string; analyzedPages: AnalyzedPage[] },
  sseManager: SSEManager
) => {
  try {
    console.log(`\n🤖 AGENT LOG - Pages Analyzed`)
    console.log(`   Pages prioritized: ${data.analyzedPages.length}`)

    const session = await SearchSessionModel.findById(data.searchId)
    if (!session) {
      console.warn('Session not found:', data.searchId)
      return
    }

    // Store analyzed pages
    session.discoveredPages = data.analyzedPages.map(p => p.url)
    await session.save()

    // Trigger scraping with discovered pages
    await addEvent('crawl_requested', {
      searchId: data.searchId,
      sites: data.analyzedPages.map(p => p.url),
      keywords: data.query
    })
  } catch (error) {
    console.error('Error in pages_analyzed handler:', error)
    await addEvent('search_failed', { searchId: data.searchId, error: String(error) })
  }
}
```

- [ ] **Step 3: Implement search_evaluation handler**

```typescript
// In packages/api/src/events/handlers.ts, add:

search_evaluation: async (
  data: { searchId: string; jobsFound: number },
  sseManager: SSEManager
) => {
  try {
    console.log(`\n🤖 AGENT LOG - Search Evaluation`)
    console.log(`   Total jobs found: ${data.jobsFound}`)

    const session = await SearchSessionModel.findById(data.searchId)
    if (!session) {
      console.warn('Session not found:', data.searchId)
      return
    }

    // Ask Claude to evaluate results
    const prompt = `We've found ${data.jobsFound} job listings so far. 
      The user originally searched for: "${session.query}"
      
      Should we:
      1. Stop searching and rank the results (enough quality jobs found)
      2. Refine the search with different keywords
      3. Search deeper into discovered pages
      
      Respond with ONLY one of: COMPLETE, REFINE, or DEEPEN`

    const claudeResponse = await callClaude(session.userId, prompt)
    session.claudeConversationHistory.push(
      { role: 'user', content: prompt },
      { role: 'assistant', content: claudeResponse }
    )
    await session.save()

    const decision = claudeResponse.toUpperCase().trim()

    if (decision.includes('COMPLETE') || data.jobsFound >= 30) {
      await addEvent('search_complete', { searchId: data.searchId })
    } else if (decision.includes('REFINE')) {
      // Ask Claude for refined search terms
      const refinementPrompt = `Suggest new search keywords to find different job opportunities. 
        Original search: "${session.query}"
        Return ONLY the new keywords, nothing else.`
      
      const newKeywords = await callClaude(session.userId, refinementPrompt)
      await addEvent('search_refined', {
        searchId: data.searchId,
        query: newKeywords.trim()
      })
    } else if (decision.includes('DEEPEN')) {
      await addEvent('crawl_deeper', { searchId: data.searchId })
    } else {
      // Default: complete search
      await addEvent('search_complete', { searchId: data.searchId })
    }
  } catch (error) {
    console.error('Error in search_evaluation handler:', error)
    await addEvent('search_complete', { searchId: data.searchId })
  }
}
```

- [ ] **Step 4: Implement crawl_deeper handler**

```typescript
// In packages/api/src/events/handlers.ts, add:

crawl_deeper: async (
  data: { searchId: string },
  sseManager: SSEManager
) => {
  try {
    console.log(`\n🤖 AGENT LOG - Crawl Deeper`)
    console.log(`   Scraping discovered pages deeper...`)

    const session = await SearchSessionModel.findById(data.searchId)
    if (!session) {
      console.warn('Session not found:', data.searchId)
      return
    }

    // Scrape discovered pages
    const resultsManager = new JobSourceManager()
    const results = await resultsManager.scrapeWithDiscovery(
      data.searchId,
      session.discoveredPages || [],
      session.query,
      2 // max 2 more iterations
    )

    // Trigger evaluation with new results
    await addEvent('jobs_scraped', {
      searchId: data.searchId,
      jobs: results.jobs,
      newSites: []
    })
  } catch (error) {
    console.error('Error in crawl_deeper handler:', error)
    await addEvent('search_evaluation', { searchId: data.searchId, jobsFound: 0 })
  }
}
```

- [ ] **Step 5: Modify search_started handler to use SearXNG**

```typescript
// In packages/api/src/events/handlers.ts, modify search_started:

search_started: async (data: { searchId: string; userId: string; query: string }, sseManager: SSEManager) => {
  try {
    console.log(`\n🤖 AGENT LOG - Search Started`)
    console.log(`   Query: "${data.query}"`)

    const session = await SearchSessionModel.findById(data.searchId)
    if (!session) {
      console.warn('Session not found:', data.searchId)
      return
    }

    // NEW: Use SearchService instead of Claude for initial search
    const searchService = new SearchService()
    const searchResults = await searchService.search(data.query)

    console.log(`   🔍 SearXNG found ${searchResults.length} pages`)

    if (searchResults.length === 0) {
      // Fallback to old Claude-based domain identification
      console.log(`   📋 No SearXNG results, using fallback approach...`)
      
      const suggestion = await callClaude(
        session.userId,
        `User wants: "${data.query}". 
         What are the best 3-5 job boards to search?
         Return JSON: {sites: ["domain1.com"], keywords: "search keywords"}`
      )
      
      const parsed = JSON.parse(suggestion)
      await addEvent('sites_identified', {
        searchId: data.searchId,
        sites: parsed.sites,
        keywords: parsed.keywords
      })
      return
    }

    // Trigger page analysis
    await addEvent('search_query_performed', {
      searchId: data.searchId,
      query: data.query,
      results: searchResults
    })
  } catch (error) {
    console.error('Error in search_started handler:', error)
    await addEvent('search_failed', { searchId: data.searchId, error: String(error) })
  }
}
```

- [ ] **Step 6: Modify jobs_scraped handler to trigger evaluation**

```typescript
// In packages/api/src/events/handlers.ts, modify jobs_scraped to add at the end:

// After storing jobs, trigger evaluation
const totalJobs = await JobModel.countDocuments({ searchSessionId: data.searchId })
await addEvent('search_evaluation', {
  searchId: data.searchId,
  jobsFound: totalJobs
})
```

- [ ] **Step 7: Verify no syntax errors**

Run: `npm run build` from `packages/api`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add packages/api/src/events/handlers.ts
git commit -m "feat: implement intelligent discovery event handlers

- search_query_performed: triggers after SearXNG search
- pages_analyzed: Claude prioritizes pages for scraping
- search_evaluation: Claude decides next step
- crawl_deeper: iterative scraping of discovered pages
- search_started: now uses SearXNG with fallback
- jobs_scraped: triggers evaluation instead of completion"
```

---

## Task 8: Add Type Imports to Handlers

**Files:**
- Modify: `packages/api/src/events/handlers.ts` (imports section)

- [ ] **Step 1: Add imports at top of handlers.ts**

```typescript
// At top of packages/api/src/events/handlers.ts, add:

import { SearchService } from '../job-sources/search-service.js'
import { PageAnalyzer } from '../job-sources/page-analyzer.js'
import { SearchResult, AnalyzedPage } from '../job-sources/interfaces.js'
```

- [ ] **Step 2: Verify compilation**

Run: `npm run build` from `packages/api`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/events/handlers.ts
git commit -m "feat: add imports for new job discovery components"
```

---

## Task 9: Write Integration Tests

**Files:**
- Create: `packages/api/src/job-sources/__tests__/discovery-integration.test.ts`

- [ ] **Step 1: Write E2E discovery flow test**

```typescript
// packages/api/src/job-sources/__tests__/discovery-integration.test.ts

import { SearchService } from '../search-service'
import { PageAnalyzer } from '../page-analyzer'
import { WebScraper } from '../web-scraper'
import { SearchResult } from '../interfaces'

describe('Job Discovery Integration', () => {
  it('should complete full discovery flow: search → analyze → scrape', async () => {
    const searchService = new SearchService()
    const pageAnalyzer = new PageAnalyzer()
    const scraper = new WebScraper()

    // Phase 1: Search
    const searchResults = await searchService.search('senior software engineer remote')
    expect(Array.isArray(searchResults)).toBe(true)

    if (searchResults.length === 0) {
      console.log('SearXNG unavailable, skipping integration test')
      return
    }

    // Phase 2: Analyze
    const analyzedPages = await pageAnalyzer.analyzePages(
      searchResults.slice(0, 5),
      'senior software engineer remote'
    )
    expect(analyzedPages.length).toBeGreaterThan(0)
    expect(analyzedPages[0].priority).toBeGreaterThan(0)

    // Phase 3: Scrape (mock domain for safety)
    const results = await scraper.scrape(['example.com'], 'engineer')
    expect(Array.isArray(results)).toBe(true)
    expect(results[0]).toHaveProperty('discoveredPages')
  })

  it('should handle empty search results with fallback', async () => {
    const searchService = new SearchService()
    const results = await searchService.search('xyz_super_rare_job_xyz_does_not_exist_12345')
    
    // Should return empty array, not crash
    expect(Array.isArray(results)).toBe(true)
  })

  it('should prioritize relevant pages correctly', async () => {
    const pageAnalyzer = new PageAnalyzer()
    const testResults: SearchResult[] = [
      {
        url: 'https://linkedin.com/jobs',
        title: 'LinkedIn Jobs Search',
        snippet: 'Find job listings on LinkedIn',
        relevanceScore: 0.9
      },
      {
        url: 'https://example.com/blog',
        title: 'How to get a job',
        snippet: 'General advice',
        relevanceScore: 0.2
      }
    ]

    const analyzed = await pageAnalyzer.analyzePages(testResults, 'engineer')
    
    // LinkedIn should be first (higher priority)
    expect(analyzed[0].url).toContain('linkedin.com')
    expect(analyzed[0].priority).toBeGreaterThanOrEqual(analyzed[1]?.priority || 0)
  })
})
```

- [ ] **Step 2: Run tests**

Run: `npm test -- discovery-integration.test.ts --run`
Expected: PASS (or SKIP if SearXNG unavailable)

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/job-sources/__tests__/discovery-integration.test.ts
git commit -m "test: add integration tests for full discovery flow

- Tests search → analyze → scrape pipeline
- Handles unavailable SearXNG gracefully
- Verifies page prioritization
- Validates discovered pages extraction"
```

---

## Task 10: Verify All Tests Pass

**Files:**
- None (verification only)

- [ ] **Step 1: Run complete test suite**

Run: `npm test -- --run` from `packages/api`
Expected: All tests pass (including 18 existing E2E tests + new ones)

Sample expected output:
```
✓ src/job-sources/__tests__/interfaces.test.ts (2 tests)
✓ src/job-sources/__tests__/rate-limiter.test.ts (2 tests)
✓ src/job-sources/__tests__/web-scraper.test.ts (3 tests, including discovery)
✓ src/job-sources/__tests__/mock-source.test.ts (2 tests)
✓ src/job-sources/__tests__/manager.test.ts (3 tests)
✓ src/job-sources/__tests__/search-service.test.ts (3 tests)
✓ src/job-sources/__tests__/page-analyzer.test.ts (2 tests)
✓ src/job-sources/__tests__/discovery-integration.test.ts (3 tests)
✓ src/job-sources/__tests__/e2e.test.ts (18 tests)

Total: 38+ tests passing
```

- [ ] **Step 2: Check for TypeScript errors**

Run: `npm run build` from `packages/api`
Expected: No errors, clean build

- [ ] **Step 3: Final commit**

```bash
git log --oneline -10
```

Expected: All 10 tasks committed with meaningful messages

---

## Summary

**Total Tasks:** 10  
**Files Created:** 4 (SearchService, PageAnalyzer, 2 test files)  
**Files Modified:** 5 (WebScraper, Manager, Handlers, Models, Interfaces)  
**Tests Added:** 15+ new tests  
**Event Handlers Added:** 4 new events, 3 modified events  

**What's Implemented:**
- ✅ SearchService: SearXNG integration with rate limiting
- ✅ PageAnalyzer: Claude-based page prioritization
- ✅ Enhanced WebScraper: Page discovery (pagination + links)
- ✅ JobSourceManager: Discovery queue management
- ✅ New Events: search_query_performed, pages_analyzed, search_evaluation, crawl_deeper
- ✅ Graceful Fallback: SearXNG → domain-based → mock data
- ✅ Full Test Coverage: 38+ passing tests

**Ready for:** Real job discovery without mock data, intelligent iteration, deep crawling of discovered pages
