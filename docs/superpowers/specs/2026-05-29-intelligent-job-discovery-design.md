# Intelligent Job Discovery System: Design Specification

**Date:** May 29, 2026  
**Status:** Approved  
**Version:** 1.0  
**Author:** Claude Code  

---

## 1. Executive Summary

Replace mock job data with an intelligent discovery system that uses **SearXNG** to find real job listing pages, **Claude** to analyze which pages contain jobs, and an **enhanced scraper** to extract jobs while discovering deeper pages through pagination and internal links.

**Problem Being Solved:** Current system falls back to mock data when real job scrapers fail. Users see artificial data instead of discovering real opportunities.

**Solution:** Implement a three-phase approach: (1) Search for job pages via SearXNG, (2) Claude analyzes results to identify job boards, (3) WebScraper extracts jobs and discovers new pages iteratively.

**Success Criteria:**
- Real job listings returned on successful searches
- Graceful fallback to domain-based scraping if SearXNG fails
- Claude intelligently decides when search has sufficient results
- Pagination and internal link discovery enabled
- Support iterative refinement: Claude can request deeper crawling or refined searches

---

## 2. Current State vs. Proposed State

### Current Flow
```
User Query
  ↓
Claude identifies job boards (linkedin.com, github.com, etc.)
  ↓
WebScraper directly scrapes identified domains
  ↓
If scraper fails → Mock data fallback
```

**Problem:** Limited to known domains, no discovery, quick fallback to artificial data.

### Proposed Flow
```
User Query
  ↓
SearXNG searches the web for job listing pages
  ↓
Claude analyzes search results → identifies job boards
  ↓
WebScraper extracts jobs + discovers new pages
  (pagination links, internal career pages, etc.)
  ↓
Claude evaluates results → enough? refine? go deeper?
  ↓
If SearXNG fails → fallback to domain-based scraping
  ↓
If that fails → mock data
```

**Benefit:** Discovers real jobs, niche job boards, enables iterative refinement.

---

## 3. Architecture & Components

### 3.1 New Components

#### SearchService (`src/job-sources/search-service.ts`)
**Purpose:** Query SearXNG API to find job listing pages.

**Interface:**
```typescript
interface SearchResult {
  url: string
  title: string
  snippet: string
  relevanceScore: number
}

class SearchService {
  async search(query: string, options?: SearchOptions): Promise<SearchResult[]>
  // Calls SearXNG API, returns top job listing pages
  // Handles rate limiting via RateLimiter
}
```

**Behavior:**
- Takes user query (e.g., "remote backend engineer python")
- Calls SearXNG API with job-specific keywords
- Returns sorted list of URLs that likely contain job postings
- Respects RateLimiter to avoid overwhelming SearXNG

**Error Handling:**
- Network timeout → returns empty array (triggers fallback)
- SearXNG API down → returns empty array (triggers fallback)
- Rate limited → backs off and retries

---

#### PageAnalyzer (`src/job-sources/page-analyzer.ts`)
**Purpose:** Use Claude to identify which search results actually contain jobs.

**Interface:**
```typescript
interface AnalyzedPage {
  url: string
  confidence: number // 0-1
  reason: string
  priority: number // 1-10
}

class PageAnalyzer {
  async analyzePages(
    results: SearchResult[],
    userQuery: string
  ): Promise<AnalyzedPage[]>
  // Calls Claude to prioritize which pages to scrape
}
```

**Behavior:**
- Takes SearXNG results + original user query
- Calls Claude: "Of these pages, which contain job listings relevant to [query]?"
- Claude returns confidence scores and priority rankings
- Returns sorted list (highest priority first)

**Claude Prompt Example:**
```
Given the user is searching for: "remote Python backend engineer"
And these pages were found: [list of URLs]

For each URL, determine:
1. Does it likely contain job postings? (confidence 0-1)
2. How relevant are the jobs to the user's query? (priority 1-10)
3. Why? (brief reason)

Focus on pages that are job boards, company career pages, or aggregators.
Return JSON with your analysis.
```

**Error Handling:**
- Claude API fails → use all results with equal priority
- Unexpected response format → fallback to simple heuristics

---

#### Enhanced WebScraper (modify existing)
**Current Responsibility:** Extract jobs from HTML pages  
**Added Responsibility:** Discover new pages to scrape

**Modified Interface:**
```typescript
interface ScrapingResult {
  source: string
  jobs: Job[]
  discoveredPages: string[] // NEW: pagination, internal links
  errors: ScrapingError[]
}

class WebScraper extends JobSource {
  async scrape(
    domains: string[],
    keywords: string,
    options?: ScrapingOptions
  ): Promise<ScrapingResult[]>
}
```

**New Behavior:**
- Extract jobs (existing behavior)
- **NEW:** While scraping, identify and collect:
  - Pagination links (`href="/jobs?page=2"`)
  - Internal company career page links
  - Job listing archive/filter page links
- Return discovered pages in `discoveredPages` array
- Limit discovered pages to prevent infinite crawling (max 10 per domain)

**Discovery Strategy:**
1. Parse all `<a>` tags on the page
2. Identify pagination patterns:
   - `?page=`, `?p=`, `/page/`
   - `next`, `pagination`, `load-more`
3. Identify career/jobs pages:
   - URLs containing `/careers/`, `/jobs/`, `/opportunities/`
   - Links pointing to different job categories
4. Rank by relevance (pagination > category pages > others)
5. Return top 5 discovered pages per scraped page

---

### 3.2 Modified Components

#### JobSourceManager (existing, enhanced)
**Changes:**
- Add `discoveredPages` queue management
- Track pages already scraped (prevent infinite loops)
- Prioritize discovered pages in scraping order
- Integrate new SearchService and PageAnalyzer

**New Methods:**
```typescript
async scrapeWithDiscovery(
  initialQuery: string,
  maxIterations: number = 3
): Promise<AggregatedResults>
  // Orchestrates: search → analyze → scrape → discovery loop
```

---

#### Event Handlers (`src/events/handlers.ts`)
**Modified Events:**

1. **`search_started`** (existing, modified)
   - Now triggers SearXNG search instead of just Claude identification
   - Calls SearchService with user query

2. **`search_query_performed`** (NEW)
   - Triggered after SearXNG returns results
   - Data: `{ searchId, query, results: SearchResult[] }`
   - Next handler: `pages_analyzed`

3. **`pages_analyzed`** (NEW)
   - Triggered after Claude prioritizes pages
   - Data: `{ searchId, analyzedPages: AnalyzedPage[] }`
   - Next handler: `crawl_requested`

4. **`crawl_requested`** (existing, enhanced)
   - Now receives prioritized pages from PageAnalyzer
   - Also receives `discoveredPages` queue from previous iterations
   - Scraper adds newly discovered pages to queue

5. **`jobs_scraped`** (existing, enhanced)
   - Includes `discoveredPages` array
   - Triggers `search_evaluation` to decide next step

6. **`search_evaluation`** (NEW)
   - Claude evaluates collected jobs
   - Decides: "enough jobs collected?" or "refine search?" or "scrape deeper?"
   - Branches to: `search_complete`, `search_refined`, or `crawl_deeper`

7. **`search_refined`** (existing, enhanced)
   - Triggered when Claude wants different search keywords
   - Loops back to `search_query_performed` with new query

8. **`crawl_deeper`** (NEW)
   - Triggered when Claude wants to scrape discovered pages
   - Takes top discovered pages and queues them for scraping

---

## 4. Event Flow Diagram

```
search_started
  (user initiates search with query)
    ↓
[SearchService: SearXNG search]
    ↓
search_query_performed
  (SearXNG returns URLs)
    ↓
[PageAnalyzer: Claude analyzes pages]
    ↓
pages_analyzed
  (Claude prioritized pages 1-10)
    ↓
crawl_requested
  (queue prioritized pages + any discovered pages from queue)
    ↓
[WebScraper: extract jobs + discover new pages]
    ↓
jobs_scraped
  (jobs found: N, discovered pages: M)
    ↓
search_evaluation
  (Claude: "enough? refine? go deeper?")
    ├─→ search_complete (Claude: "we have good results")
    ├─→ search_refined (Claude: "search with different keywords")
    │    ↓
    │    [loop back to search_query_performed with new query]
    │
    └─→ crawl_deeper (Claude: "discovered pages look promising")
         ↓
         [scrape discovered pages]
         ↓
         [back to jobs_scraped]
```

---

## 5. Graceful Degradation (Fallback Chain)

```
Level 1: SearXNG → Claude Analysis → WebScraper
  Success: Return real jobs found on discovered pages
  Failure: ↓

Level 2: Claude Identifies Known Domains → WebScraper
  (linkedin.com, github.com, stackoverflow.com, etc.)
  Success: Return jobs from these domains
  Failure: ↓

Level 3: Mock Data Fallback
  Return curated mock job data (current behavior)
```

**Triggers for fallback:**
- Level 1 → Level 2: SearXNG returns 0 results, or all scrapers fail
- Level 2 → Level 3: Known domain scrapers fail or return 0 jobs

---

## 6. Data Models

### SearchSession (MongoDB, modified)
```typescript
{
  _id: ObjectId,
  userId: string,
  query: string,
  status: 'running' | 'complete' | 'failed',
  
  // Search phases (NEW)
  searchPhase: 'initial' | 'refined',
  searchQueries: string[], // ['remote backend', 'mid-level python', ...]
  
  // Discovered pages tracking (NEW)
  discoveredPages: string[], // URLs found during scraping
  scrapedPages: string[], // URLs already processed
  
  // Existing fields
  claudeConversationHistory: Array<{ role, content }>,
  foundJobs: ObjectId[], // job._id references
  sitesSearched: string[],
  iterationCount: number,
  startedAt: Date,
  completedAt?: Date
}
```

### Page Discovery Queue (in-memory, ephemeral)
```typescript
interface DiscoveryQueue {
  searchId: string
  pendingPages: Array<{
    url: string
    source: string // "pagination" | "internal_link" | "discovered"
    priority: number
    discoveredFrom: string // parent URL
  }>
  scrapedPages: Set<string> // prevent revisiting
}
```

---

## 7. Configuration & Limits

**SearXNG:**
- Rate limit: 1 request per 2 seconds (RateLimiter)
- Timeout: 10 seconds per request
- Results per search: 15 URLs

**WebScraper:**
- Max discovered pages per domain: 10
- Max scraping depth: 3 levels (initial → pagination → internal links)
- Timeout: 15 seconds per page
- Max concurrent scrapes: 2 (rate limiting)

**Claude Analysis:**
- Pages analyzed per call: max 20 (batch reduce if needed)
- Max iterations: 3 (search → refine → deeper crawl)

**Overall Search:**
- Max duration: 5 minutes
- Max jobs to collect: 50 (soft limit, can exceed if high quality)

---

## 8. Error Handling

| Component | Error | Behavior |
|-----------|-------|----------|
| SearchService | SearXNG timeout | Return empty, trigger fallback to Level 2 |
| SearchService | 0 results | Return empty, trigger fallback to Level 2 |
| PageAnalyzer | Claude API fails | Use all results with equal priority |
| PageAnalyzer | Invalid response | Fallback to heuristics (title/snippet match) |
| WebScraper | Page timeout | Skip page, continue with others |
| WebScraper | Parse error | Return 0 jobs, continue with discovered pages |
| Search Evaluation | Claude fails | Return jobs collected so far, mark complete |
| Overall | All levels fail | Return mock data with warning |

---

## 9. Testing Strategy

### Unit Tests
- **SearchService:** Mock SearXNG API, verify request format, response parsing
- **PageAnalyzer:** Mock Claude API, verify prompt construction, response handling
- **WebScraper:** Mock HTML pages, verify job extraction and page discovery
- **JobSourceManager:** Verify orchestration logic, queue management

### Integration Tests
- **End-to-end flow:** search_started → search_complete, verify jobs returned
- **Fallback chain:** Simulate each failure level, verify proper fallback
- **Page discovery:** Verify pagination links discovered and queued
- **Iteration:** Verify search_refined loops correctly

### E2E Tests (existing)
- Extend current E2E suite to cover new components
- Test with real SearXNG API (rate limited)
- Verify mock data only returned as last resort

---

## 10. Implementation Phases

### Phase 1: Core Components (1-2 days)
- SearchService with SearXNG integration
- PageAnalyzer with Claude integration
- WebScraper page discovery
- New event handlers

### Phase 2: Integration (1 day)
- Wire components together in handlers
- Implement graceful fallbacks
- Test event flow

### Phase 3: Refinement (1 day)
- Optimize Claude prompts
- Tune page discovery heuristics
- Performance testing, rate limiting

---

## 11. Success Criteria

✅ Users see real job listings (not mock data) on successful searches  
✅ System discovers niche job boards (RemoteOK, We Work Remotely, etc.)  
✅ Pagination enabled (finds "next page" links and scrapes them)  
✅ Internal link discovery works (company career pages from job postings)  
✅ Claude intelligently decides when to stop searching  
✅ Graceful fallback if SearXNG/scraping fails  
✅ No infinite loops (max iterations, visited page tracking)  
✅ All tests pass (18 existing E2E tests + new ones)  

---

## 12. Out of Scope (Future Enhancements)

- Multimodal job discovery (videos, podcasts)
- User-provided job boards/sources
- ML-based relevance ranking
- Job application automation
- Real-time job alert subscriptions

