# Company-Focused Job Discovery System Redesign

**Date:** 2026-06-10  
**Status:** Design Phase  
**Scope:** Crawler architecture redesign to focus on company career pages instead of job aggregators

---

## Executive Summary

The current system scrapes job aggregators (Indeed, LinkedIn, Glassdoor) which actively block automated access. This redesign shifts to discovering and crawling company career pages directly — the primary source of truth for job listings.

**Key changes:**
- Search for "[job title] careers" instead of generic job board searches
- Discover companies via search results, validate with LLM
- Incrementally crawl company sites, discovering new companies along the way
- Progressive job matching: quick keyword filtering → batch LLM scoring
- Frontend shows paginated results (10/page) with background pre-fetching

---

## Problem Statement

**Current limitations:**
1. Job boards block scrapers with WAF/rate limiting
2. No company discovery mechanism — we hardcode job board lists
3. Jobs are ranked by a single LLM pass, no incremental refinement
4. Search workflow is linear (find sites → crawl → score → done)

**Desired state:**
1. Scrape directly from company sources (unblocked, legitimate)
2. Discover companies dynamically based on user query
3. Continuous discovery loop: crawl company → find more companies → expand search
4. Progressive results: show jobs as they're found and scored

---

## Architecture

### Data Model Changes

#### New: Company Collection

```typescript
interface Company {
  _id: ObjectId
  url: string              // e.g., "careers.acme-corp.com" or "acme-corp.com/careers"
  name: string             // e.g., "Acme Corporation"
  location?: string        // e.g., "San Francisco, CA"
  industry?: string        // Optional: inferred from page content
  searchQuery: string      // Indexed: which user query led to discovery
  discoveredFrom: string   // URL of page where we found this company
  status: enum {           // Indexed
    pending_crawl          // Queued, waiting to be crawled
    crawling               // Currently being scraped
    crawled                // Successfully crawled (jobs extracted)
    failed                 // Crawl failed (too many retries)
  }
  crawlAttempts: number    // Count of crawl attempts
  lastCrawlTime?: Date
  createdAt: Date
  updatedAt: Date
}
```

#### Updated: Job Collection

Add these fields to existing Job model:

```typescript
interface Job {
  // ... existing fields (title, company, description, url, salary, location, sourceUrl)
  
  companyId?: ObjectId           // Reference to Company record
  discoveryMethod: "company_page" // (was "job_board", now only "company_page")
  keywordMatchScore?: number      // 0-1: quick keyword match on extraction
  keywordMatchReasoning?: string  // Why keyword match passed/failed
  
  // Tracking
  extractedAt: Date
  scoredAt?: Date
  scoredVersion: number           // Track scoring iterations
}
```

#### Updated: SearchSession Collection

Add tracking for company discovery:

```typescript
interface SearchSession {
  // ... existing fields
  
  companiesDiscovered: number     // Total unique companies found
  companiesCrawled: number        // Crawls completed (success + failure)
  companiesRemaining: number      // Still in queue
  
  jobsExtracted: number           // Total jobs found
  jobsScored: number              // Jobs with LLM scoring
  
  currentCrawlBatch: number       // Which batch we're on (1, 2, 3, ...)
  expandedSearch: boolean         // Did we go beyond first 10-15 companies?
}
```

---

## Event-Driven Workflow

### Phase 1: Company Discovery

**Event: `search_started`**
- Input: `{ searchId, userId, query }`
- Action: Search SearXNG for `"${query} careers"` (e.g., "senior python engineer careers")
- Output: List of URLs with snippets
- Next event: `careers_pages_found`

**Event: `careers_pages_found`**
- Input: `{ searchId, results: SearchResult[] }`
- Action:
  1. Filter out known job aggregators (hardcoded blocklist):
     - `indeed.com`, `linkedin.com`, `glassdoor.com`, `dice.com`, `builtin.com`
     - `monster.com`, `careerbuilder.com`, `ziprecruiter.com`, etc.
  2. Pass filtered results to LLM with prompt:
     ```
     These are search results for "[query] careers". 
     Identify company career pages. For each, extract:
     - company_name (e.g., "Acme Corp")
     - company_location (e.g., "San Francisco, CA")
     - url (the careers page URL)
     Return JSON: { companies: [{name, location, url}, ...] }
     ```
  3. Validate LLM output (at least one company found, valid URLs)
- Output: List of validated company sites
- Next event: `companies_identified`

**Event: `companies_identified`**
- Input: `{ searchId, companies: {name, location, url}[] }`
- Action:
  1. Store each company in Company collection with:
     - `status: "pending_crawl"`
     - `discoveredFrom: "search_results"`
     - `searchQuery: original_query`
  2. Select first batch: min(10, total_found) companies
  3. Mark batch for crawling
- Output: List of company IDs ready to crawl
- Next event: `companies_queued_for_crawl`

### Phase 2: Crawling & Discovery

**Event: `companies_queued_for_crawl`**
- Input: `{ searchId, companyIds: ObjectId[] }`
- Action: Queue each company for the crawler service
- Output: Queued company IDs
- Next event: `crawl_company` (one per company, sent to crawler)

**Event: `crawl_company` (sent to Python crawler)**
- Input: `{ searchId, companyId, url, companyName }`
- Action (in crawler):
  1. Fetch URL, render if needed (some sites require JS)
  2. Extract job listings using spiders/heuristics
  3. Extract linked company references (if any: "Join our team at [sister company]")
  4. Return: `{ jobs: [...], discoveredCompanies: [{name, location, url}, ...] }`
- Next event: `company_crawled` (sent back to API)

**Event: `company_crawled`**
- Input: `{ searchId, companyId, jobs: JobData[], discoveredCompanies: CompanyData[] }`
- Action:
  1. Update Company record: `status: "crawled"`, `lastCrawlTime: now`
  2. Store discovered companies:
     - Run through LLM validation (is it a real company, not another job board?)
     - Store as `status: "pending_crawl"` if valid
  3. Store extracted jobs:
     - Do quick keyword matching (does job title match query?)
     - Store with `keywordMatchScore` (0-1 based on title/description match)
     - Store with `status: "pending_scoring"` if keyword match passes threshold
  4. Track stats: `companiesCrawled++`, `jobsExtracted += job_count`
  5. Check if we need to expand search:
     - If `jobsExtracted < 20` and `companiesRemaining > 0`: stay in current batch or start next batch
     - If `jobsExtracted >= 20` and `companiesRemaining > 0`: mark next batch for crawling (adaptive)
- Output: Job extraction stats
- Next event: `jobs_extracted` (for jobs passing keyword match) + possibly `companies_queued_for_crawl` (if expanding)

### Phase 3: Job Scoring

**Event: `jobs_extracted`**
- Input: `{ searchId, jobIds: ObjectId[] }`
- Action:
  1. Collect all jobs with `status: "pending_scoring"` for this search
  2. Batch them (collect up to 20 jobs or wait 5 seconds)
  3. Send batch to LLM for detailed scoring:
     ```
     User searched for: "${query}"
     Rate these jobs by match score (0-100) and explain:
     - Job 1: {title, company, description}
     - Job 2: ...
     Return: [{jobId, matchScore: 0-100, reasoning: "...", isRelevant: boolean}]
     ```
  4. Update each Job:
     - `matchScore`, `matchReasoning`, `scoredAt: now`, `status: "scored"`
  5. Send to frontend via SSE
- Output: Scored jobs
- Next event: `results_ready_for_frontend`

**Event: `results_ready_for_frontend`**
- Input: `{ searchId, scoredJobIds: ObjectId[] }`
- Action: Signal to frontend that new results are available (via SSE or REST poll)
- Output: None (state change only)

**Event: `search_complete` (final)**
- Triggered when:
  - No more companies to crawl, AND
  - All extracted jobs have been scored
- Action: Mark SearchSession as `status: "complete"`

---

## Crawler Service Changes

### Python Crawler Updates

The Flask server already exists (`server.py`). We'll extend it:

**New endpoint: `POST /crawler/crawl-company`**
```
Input: { searchId, companyId, url, companyName, query }
Output: {
  jobs: [
    {
      title: "Senior Engineer",
      company: "Acme",
      description: "...",
      url: "...",
      salary?: "...",
      location?: "...",
      sourceUrl: url
    }
  ],
  discoveredCompanies: [
    {
      name: "Sister Company Inc",
      location: "NYC",
      url: "https://..."
    }
  ]
}
```

**New spider: `GenericCareerPageSpider`**
- Target: company career pages (not a specific job board)
- Heuristics:
  - Look for job listings in common CSS classes/IDs
  - Extract job title, description, apply link
  - Look for links to other companies (common pattern: "We're hiring at our sister company...")
  - Use LLM fallback: if extraction fails, prompt Claude to extract jobs from page HTML

**Rate limiting & resilience:**
- Per-domain rate limiting already implemented
- Circuit breaker for repeated failures
- Retry strategy for transient errors
- User-Agent rotation

---

## Frontend Changes

### Results Display

**New pagination model:**
```typescript
interface SearchResultsPage {
  page: number              // 1-indexed
  totalJobs: number         // Total jobs found so far
  jobs: Job[]               // 10 jobs per page
  isLoading: boolean        // True if more jobs are being discovered
  hasMore: boolean          // True if more pages available
}
```

**Behavior:**
1. User sees page 1 (jobs 1-10) as they're scored
2. Frontend pre-fetches page 2 in background
3. When user clicks "Load More" or reaches bottom:
   - If page 2 is ready, show it immediately
   - If still loading, show spinner and wait
4. Continue pre-fetching page 3 in background
5. Real-time indicator: "Discovering more jobs..." when crawler is active

### API Changes

**Existing endpoint `GET /api/searches/{searchId}/jobs` updated:**
- Add query params: `?page=1&pageSize=10`
- Returns: `{ jobs: [...], page, totalJobs, isLoading, hasMore }`

**New endpoint `GET /api/searches/{searchId}/status`**
- Returns: `{ status, companiesDiscovered, companiesCrawled, jobsExtracted, jobsScored, expandedSearch }`
- Used to show progress to user

---

## Implementation Sequence

### Phase 1: Data Model & Events (Foundation)
1. Add Company collection to MongoDB
2. Update Job schema with new fields
3. Update SearchSession schema
4. Add event handlers: `careers_pages_found`, `companies_identified`, `companies_queued_for_crawl`, `company_crawled`, `jobs_extracted`, `results_ready_for_frontend`

### Phase 2: Crawler Integration
1. Update Python crawler to accept company-specific requests
2. Implement `GenericCareerPageSpider`
3. Add discovered company extraction logic
4. Test crawler on real company sites

### Phase 3: Frontend & API
1. Update results endpoint with pagination
2. Update results component to handle pre-fetching
3. Add progress indicator showing company discovery
4. Test pagination and background loading

### Phase 4: Integration & Polish
1. End-to-end testing
2. Handle edge cases (sites that require JS, no jobs found, etc.)
3. Optimize: batch sizing, crawl concurrency, scoring frequency

---

## Error Handling & Edge Cases

**Company discovery:**
- If LLM validation returns no companies: fall back to manual search in SearXNG results
- If all companies fail to crawl: emit event for user notification

**Job extraction:**
- If site requires JavaScript: use Playwright headless mode in crawler
- If no jobs found on site: mark company as `status: "crawled"` anyway, move on

**Scoring:**
- If batch scoring fails: retry with smaller batch
- If LLM can't score a job: assign default `matchScore: 0.5`

**Pagination:**
- If user requests page 5 but only 3 pages exist: return empty
- If more jobs arrive while user is on page 2: don't refresh automatically, show notification

---

## Testing Strategy

**Unit tests:**
- Company discovery: LLM parsing and validation
- Job extraction: keyword matching logic
- Event handlers: ensure correct state transitions

**Integration tests:**
- Mock company sites with sample job listings
- Test full workflow: search → discover → crawl → score → display
- Test pagination and background pre-fetching

**End-to-end tests:**
- Real company sites (a few safe ones like github.com/careers, stripe.com/jobs)
- Full user flow: search → wait for results → scroll through pages

---

## Success Criteria

- ✅ Crawl 10-15 company sites per search without hitting WAF blocks
- ✅ Extract 20+ job listings from company sites
- ✅ Discover at least 3-5 new company sites during crawling
- ✅ Display results in <5 seconds for first page, pre-fetch in background
- ✅ LLM accurately identifies company sites vs. aggregators (>90% precision)
- ✅ Jobs are correctly matched to user query (user finds relevant results)

---

## Known Limitations & Future Work

**Out of scope for this redesign:**
- Browser automation for heavy JS sites (use Playwright if needed later)
- Company metadata enrichment (industry, size, etc.)
- Deduplication across company sites (same job listed multiple places)

**Future enhancements:**
- Job board APIs as fallback (when company site has no careers page)
- Company filtering (user selects industries/locations)
- Job alerts and saved searches
- Resume parsing to auto-match jobs
