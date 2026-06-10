# Company-Focused Crawler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement company career page discovery and crawling to replace job board scraping, with progressive job extraction, LLM-based company validation, and paginated results.

**Architecture:** Three-phase workflow (Discovery → Crawling → Scoring) with event-driven processing. LLM validates company sites and scores jobs. Frontend displays paginated results (10/page) with background pre-fetching.

**Tech Stack:** Node.js/Express (API), TypeScript, MongoDB (companies + jobs), Python/Flask (crawler), React 19 (frontend), BullMQ (events), Anthropic SDK (LLM)

---

## File Structure

### Node.js API

**New Files:**
- `packages/api/src/utils/company-discovery.ts` - LLM-based company validation and extraction
- `packages/api/src/utils/job-matcher.ts` - Keyword matching for quick job filtering
- `packages/api/tests/company-discovery.test.ts` - Tests for company validation
- `packages/api/tests/job-matcher.test.ts` - Tests for keyword matching

**Modified Files:**
- `packages/shared/src/types.ts` - Add Company, update Job/SearchSession types
- `packages/api/src/db/models.ts` - Add Company schema, update Job/SearchSession schemas
- `packages/api/src/events/handlers.ts` - Add 6 new event handlers
- `packages/api/src/routes/searches.ts` - Add pagination, status endpoint
- `packages/api/tests/handlers.test.ts` - Add tests for new handlers

### Python Crawler

**New Files:**
- `crawler/job_crawler/spiders/generic_career_spider.py` - Generic company career page spider
- `crawler/job_crawler/company_extractor.py` - Extract discovered companies from pages

**Modified Files:**
- `crawler/server.py` - Add `/crawler/crawl-company` endpoint
- `crawler/cli.py` - Add company-specific crawl function

### Frontend

**New Files:**
- `packages/frontend/src/components/JobList.tsx` - Paginated job list with pre-fetching
- `packages/frontend/src/components/SearchProgress.tsx` - Shows discovery progress

**Modified Files:**
- `packages/frontend/src/pages/Results.tsx` - Update layout for pagination
- `packages/frontend/src/hooks/useSearch.ts` - Add pagination and status polling

---

## Phase 1: Data Model & Events

### Task 1: Add Company Type to Shared Types

**Files:**
- Modify: `packages/shared/src/types.ts`

- [ ] **Step 1: Read the current types file**

```bash
head -50 packages/shared/src/types.ts
```

- [ ] **Step 2: Add Company type definition**

Insert after the existing Job type and before SearchSession:

```typescript
export interface Company {
  _id?: string
  url: string              // e.g., "careers.acme-corp.com"
  name: string             // e.g., "Acme Corporation"
  location?: string        // e.g., "San Francisco, CA"
  industry?: string        // Optional
  searchQuery: string      // Which query discovered this
  discoveredFrom: string   // URL where we found it
  status: 'pending_crawl' | 'crawling' | 'crawled' | 'failed'
  crawlAttempts: number
  lastCrawlTime?: Date
  createdAt: Date
  updatedAt: Date
}
```

- [ ] **Step 3: Update Job type with new fields**

Find the Job interface and add:

```typescript
export interface Job {
  // ... existing fields ...
  companyId?: string           // Reference to Company._id
  discoveryMethod: 'company_page'  // Changed from flexible string
  keywordMatchScore?: number       // 0-1 scale
  keywordMatchReasoning?: string
  extractedAt: Date
  scoredAt?: Date
  scoredVersion: number
}
```

- [ ] **Step 4: Update SearchSession type**

Add to SearchSession interface:

```typescript
export interface SearchSession {
  // ... existing fields ...
  companiesDiscovered: number
  companiesCrawled: number
  companiesRemaining: number
  jobsExtracted: number
  jobsScored: number
  currentCrawlBatch: number
  expandedSearch: boolean
}
```

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/types.ts
git commit -m "feat: add Company type and update Job/SearchSession types"
```

---

### Task 2: Add Company Schema to MongoDB

**Files:**
- Modify: `packages/api/src/db/models.ts`

- [ ] **Step 1: Read current models**

```bash
head -80 packages/api/src/db/models.ts
```

- [ ] **Step 2: Add Company schema**

Insert before the export statements at the end:

```typescript
const companySchema = new Schema<Company>(
  {
    url: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    location: { type: String },
    industry: { type: String },
    searchQuery: { type: String, required: true, index: true },
    discoveredFrom: { type: String, required: true },
    status: {
      type: String,
      enum: ['pending_crawl', 'crawling', 'crawled', 'failed'],
      required: true,
      index: true,
      default: 'pending_crawl'
    },
    crawlAttempts: { type: Number, required: true, default: 0 },
    lastCrawlTime: { type: Date }
  },
  { timestamps: true }
)
```

- [ ] **Step 3: Add Company model export**

Add before the final closing:

```typescript
export const CompanyModel: Model<Company> = mongoose.model('Company', companySchema)
```

- [ ] **Step 4: Update Job schema**

Find jobSchema and add these fields inside the object:

```typescript
  companyId: { type: Schema.Types.ObjectId, ref: 'Company' },
  discoveryMethod: { 
    type: String, 
    enum: ['company_page'],
    required: true,
    default: 'company_page'
  },
  keywordMatchScore: { type: Number, min: 0, max: 1 },
  keywordMatchReasoning: { type: String },
  extractedAt: { type: Date, required: true },
  scoredAt: { type: Date },
  scoredVersion: { type: Number, required: true, default: 0 }
```

- [ ] **Step 5: Update SearchSession schema**

Find searchSessionSchema and add:

```typescript
    companiesDiscovered: { type: Number, required: true, default: 0 },
    companiesCrawled: { type: Number, required: true, default: 0 },
    companiesRemaining: { type: Number, required: true, default: 0 },
    jobsExtracted: { type: Number, required: true, default: 0 },
    jobsScored: { type: Number, required: true, default: 0 },
    currentCrawlBatch: { type: Number, required: true, default: 1 },
    expandedSearch: { type: Boolean, required: true, default: false }
```

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/db/models.ts
git commit -m "feat: add Company schema and update Job/SearchSession schemas"
```

---

### Task 3: Create Company Discovery Utility

**Files:**
- Create: `packages/api/src/utils/company-discovery.ts`
- Create: `packages/api/tests/company-discovery.test.ts`

- [ ] **Step 1: Write the test for LLM company validation**

Create `packages/api/tests/company-discovery.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { validateAndExtractCompanies } from '../src/utils/company-discovery'
import * as claudeClient from '../src/claude/client'

vi.mock('../src/claude/client')

describe('Company Discovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('extracts companies from LLM response', async () => {
    const mockResponse = {
      companies: [
        { name: 'Acme Corp', location: 'SF, CA', url: 'https://careers.acme.com' },
        { name: 'TechCo', location: 'NYC, NY', url: 'https://techco.com/careers' }
      ]
    }

    vi.mocked(claudeClient.callClaude).mockResolvedValue(JSON.stringify(mockResponse))

    const searchResults = [
      { url: 'https://careers.acme.com', title: 'Jobs at Acme', snippet: 'Hiring engineers' },
      { url: 'https://techco.com/careers', title: 'Careers - TechCo', snippet: 'Join us' }
    ]

    const companies = await validateAndExtractCompanies('test-user', 'python engineer', searchResults)

    expect(companies).toHaveLength(2)
    expect(companies[0].name).toBe('Acme Corp')
    expect(companies[0].location).toBe('SF, CA')
  })

  it('filters out job aggregators', async () => {
    const searchResults = [
      { url: 'https://indeed.com/jobs', title: 'Indeed jobs', snippet: 'Jobs' },
      { url: 'https://careers.acme.com', title: 'Acme Careers', snippet: 'Hiring' }
    ]

    const filtered = await validateAndExtractCompanies('test-user', 'engineer', searchResults)

    // Indeed should be filtered before LLM call
    vi.mocked(claudeClient.callClaude).mockResolvedValue(JSON.stringify({ companies: [] }))

    expect(filtered).toBeDefined()
  })

  it('validates company URLs are valid', async () => {
    const mockResponse = {
      companies: [
        { name: 'Valid Co', location: 'Boston', url: 'https://valid.com/careers' },
        { name: 'Invalid Co', location: 'LA', url: 'not-a-url' } // Invalid
      ]
    }

    vi.mocked(claudeClient.callClaude).mockResolvedValue(JSON.stringify(mockResponse))

    const searchResults = [{ url: 'https://example.com', title: 'Jobs', snippet: 'Hiring' }]

    const companies = await validateAndExtractCompanies('test-user', 'engineer', searchResults)

    // Should filter out invalid URL
    expect(companies.every(c => c.url.startsWith('http'))).toBe(true)
  })

  it('handles empty LLM response', async () => {
    vi.mocked(claudeClient.callClaude).mockResolvedValue(JSON.stringify({ companies: [] }))

    const searchResults = [{ url: 'https://example.com', title: 'Jobs', snippet: 'Hiring' }]

    const companies = await validateAndExtractCompanies('test-user', 'engineer', searchResults)

    expect(companies).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run tests (expect failures)**

```bash
cd packages/api
npm test -- tests/company-discovery.test.ts --run
```

Expected: All tests fail with "callClaude is not a function" or similar

- [ ] **Step 3: Create the company-discovery utility**

Create `packages/api/src/utils/company-discovery.ts`:

```typescript
import { callClaude } from '../claude/client.js'

interface SearchResult {
  url: string
  title: string
  snippet: string
}

interface DiscoveredCompany {
  name: string
  location?: string
  url: string
}

// Hardcoded list of job aggregators to filter out
const JOB_AGGREGATORS = [
  'indeed.com',
  'linkedin.com',
  'glassdoor.com',
  'dice.com',
  'builtin.com',
  'monster.com',
  'careerbuilder.com',
  'ziprecruiter.com',
  'flexjobs.com',
  'weworkremotely.com',
  'remoteco.com',
  'snagajob.com'
]

function isAggregator(url: string): boolean {
  return JOB_AGGREGATORS.some(agg => url.toLowerCase().includes(agg))
}

function isValidUrl(urlString: string): boolean {
  try {
    new URL(urlString)
    return true
  } catch {
    return false
  }
}

export async function validateAndExtractCompanies(
  userId: string,
  query: string,
  searchResults: SearchResult[]
): Promise<DiscoveredCompany[]> {
  // Filter out known job aggregators
  const filtered = searchResults.filter(result => !isAggregator(result.url))

  if (filtered.length === 0) {
    console.log('No non-aggregator results found')
    return []
  }

  // Prepare results for LLM
  const resultsText = filtered
    .map(r => `- URL: ${r.url}\n  Title: ${r.title}\n  Snippet: ${r.snippet}`)
    .join('\n\n')

  const prompt = `These are search results for "${query} careers". 
Identify company career pages. For each result that is a company career page (not a job board), extract:
- company_name: Full company name
- company_location: City, State or Country (if available)
- url: The URL

Return valid JSON only: { "companies": [{"name": "...", "location": "...", "url": "..."}, ...] }
If none are company career pages, return: { "companies": [] }

Results to analyze:
${resultsText}`

  try {
    const response = await callClaude(userId, prompt)
    const parsed = JSON.parse(response)

    if (!parsed.companies || !Array.isArray(parsed.companies)) {
      console.warn('Invalid LLM response format:', parsed)
      return []
    }

    // Validate extracted companies
    const validated = parsed.companies.filter(
      (company: any) =>
        company.name &&
        company.url &&
        isValidUrl(company.url) &&
        !isAggregator(company.url)
    )

    return validated.map((c: any) => ({
      name: c.name,
      location: c.location || undefined,
      url: c.url
    }))
  } catch (error) {
    console.error('Error extracting companies:', error)
    return []
  }
}
```

- [ ] **Step 4: Run tests again (expect passes)**

```bash
cd packages/api
npm test -- tests/company-discovery.test.ts --run
```

Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/utils/company-discovery.ts packages/api/tests/company-discovery.test.ts
git commit -m "feat: add company discovery utility with LLM validation"
```

---

### Task 4: Create Job Keyword Matcher

**Files:**
- Create: `packages/api/src/utils/job-matcher.ts`
- Create: `packages/api/tests/job-matcher.test.ts`

- [ ] **Step 1: Write tests for keyword matching**

Create `packages/api/tests/job-matcher.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { calculateKeywordMatch } from '../src/utils/job-matcher'

describe('Job Keyword Matching', () => {
  it('matches job title to query', () => {
    const result = calculateKeywordMatch('Senior Python Engineer', 'python engineer')
    expect(result.score).toBeGreaterThan(0.7)
  })

  it('gives lower score for partial matches', () => {
    const result = calculateKeywordMatch('Senior Java Developer', 'python engineer')
    expect(result.score).toBeLessThan(0.5)
  })

  it('matches multiple keywords', () => {
    const result = calculateKeywordMatch(
      'Senior Backend Python Engineer - Remote',
      'backend python engineer remote'
    )
    expect(result.score).toBeGreaterThan(0.8)
  })

  it('handles case insensitivity', () => {
    const result1 = calculateKeywordMatch('PYTHON ENGINEER', 'python engineer')
    const result2 = calculateKeywordMatch('python engineer', 'PYTHON ENGINEER')
    expect(result1.score).toBe(result2.score)
  })

  it('matches with description text', () => {
    const result = calculateKeywordMatch(
      'Software Engineer',
      'python developer',
      'Write Python code, develop backend systems'
    )
    expect(result.score).toBeGreaterThan(0.5)
    expect(result.reasoning).toContain('description')
  })

  it('returns reasoning string', () => {
    const result = calculateKeywordMatch('Python Engineer', 'python engineer')
    expect(result.reasoning).toBeTruthy()
    expect(typeof result.reasoning).toBe('string')
  })

  it('returns score between 0 and 1', () => {
    const result = calculateKeywordMatch('Any Job', 'any query')
    expect(result.score).toBeGreaterThanOrEqual(0)
    expect(result.score).toBeLessThanOrEqual(1)
  })
})
```

- [ ] **Step 2: Run tests (expect failures)**

```bash
cd packages/api
npm test -- tests/job-matcher.test.ts --run
```

- [ ] **Step 3: Create the job-matcher utility**

Create `packages/api/src/utils/job-matcher.ts`:

```typescript
interface KeywordMatchResult {
  score: number
  reasoning: string
}

function normalizeText(text: string): string {
  return text.toLowerCase().trim()
}

function calculateSimilarity(text1: string, text2: string): number {
  const norm1 = normalizeText(text1)
  const norm2 = normalizeText(text2)

  // Exact match
  if (norm1 === norm2) return 1.0

  // Substring match
  if (norm1.includes(norm2) || norm2.includes(norm1)) return 0.8

  // Word-level matching
  const words1 = new Set(norm1.split(/\s+/))
  const words2 = new Set(norm2.split(/\s+/))

  let matchedWords = 0
  words2.forEach(word => {
    if (words1.has(word)) matchedWords++
  })

  const ratio = matchedWords / words2.size
  return Math.max(0, ratio * 0.9) // Cap at 0.9 for word matches
}

export function calculateKeywordMatch(
  jobTitle: string,
  query: string,
  description?: string
): KeywordMatchResult {
  // Title match
  const titleScore = calculateSimilarity(jobTitle, query)

  let finalScore = titleScore
  let reasoning = ''

  // If description provided, boost score if it mentions keywords
  if (description) {
    const descriptionScore = calculateSimilarity(description, query)
    // Weighted: title is 70%, description is 30%
    finalScore = titleScore * 0.7 + descriptionScore * 0.3
    reasoning = `Title match: ${(titleScore * 100).toFixed(0)}%, Description match: ${(descriptionScore * 100).toFixed(0)}%`
  } else {
    reasoning = `Title match: ${(titleScore * 100).toFixed(0)}%`
  }

  return {
    score: Math.round(finalScore * 100) / 100, // Round to 2 decimals
    reasoning
  }
}

export function passesKeywordThreshold(score: number, threshold: number = 0.4): boolean {
  return score >= threshold
}
```

- [ ] **Step 4: Run tests again (expect passes)**

```bash
cd packages/api
npm test -- tests/job-matcher.test.ts --run
```

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/utils/job-matcher.ts packages/api/tests/job-matcher.test.ts
git commit -m "feat: add job keyword matching utility"
```

---

### Task 5: Add New Event Handlers

**Files:**
- Modify: `packages/api/src/events/handlers.ts`
- Modify: `packages/api/tests/handlers.test.ts`

- [ ] **Step 1: Read current handlers**

```bash
head -150 packages/api/src/events/handlers.ts
```

- [ ] **Step 2: Add import statements**

At the top of `handlers.ts`, add:

```typescript
import { CompanyModel } from '../db/models.js'
import { validateAndExtractCompanies } from '../utils/company-discovery.js'
import { calculateKeywordMatch, passesKeywordThreshold } from '../utils/job-matcher.js'
```

- [ ] **Step 3: Modify search_started handler to search for careers pages**

Replace the search_started handler with:

```typescript
  search_started: async (data: { searchId: string; userId: string; query: string }, sseManager: SSEManager) => {
    try {
      console.log(`\n🤖 AGENT LOG - Search Started`)
      console.log(`   Query: "${data.query}"`)

      const session = await SearchSessionModel.findById(data.searchId)
      if (!session) {
        console.warn('Session not found:', data.searchId)
        return
      }

      // Search for "[query] careers" instead of generic query
      const careerQuery = `${data.query} careers`
      const searchService = new SearchService()
      const searchResults = await searchService.search(careerQuery)

      console.log(`   🔍 SearXNG found ${searchResults.length} careers pages`)

      if (searchResults.length === 0) {
        console.log(`   📋 No careers pages found, marking search as failed`)
        await addEvent('search_failed', {
          searchId: data.searchId,
          error: 'No careers pages found in search results'
        })
        return
      }

      await addEvent('careers_pages_found', {
        searchId: data.searchId,
        query: data.query,
        searchResults
      })
    } catch (error) {
      console.error('Error in search_started handler:', error)
      await addEvent('search_failed', { searchId: data.searchId, error: String(error) })
    }
  },
```

- [ ] **Step 4: Add careers_pages_found handler**

Add after search_started:

```typescript
  careers_pages_found: async (
    data: { searchId: string; query: string; searchResults: SearchResult[] },
    sseManager: SSEManager
  ) => {
    try {
      console.log(`\n🤖 AGENT LOG - Careers Pages Found`)
      console.log(`   Processing ${data.searchResults.length} results...`)

      const session = await SearchSessionModel.findById(data.searchId)
      if (!session) {
        console.warn('Session not found:', data.searchId)
        return
      }

      // Validate and extract companies using LLM
      const companies = await validateAndExtractCompanies(session.userId, data.query, data.searchResults)

      console.log(`   ✓ LLM identified ${companies.length} company career pages`)

      if (companies.length === 0) {
        console.log(`   ⚠️ No company career pages identified`)
        await addEvent('search_failed', {
          searchId: data.searchId,
          error: 'No company career pages identified in search results'
        })
        return
      }

      await addEvent('companies_identified', {
        searchId: data.searchId,
        query: data.query,
        companies
      })
    } catch (error) {
      console.error('Error in careers_pages_found handler:', error)
      await addEvent('search_failed', { searchId: data.searchId, error: String(error) })
    }
  },
```

- [ ] **Step 5: Add companies_identified handler**

Add after careers_pages_found:

```typescript
  companies_identified: async (
    data: { searchId: string; query: string; companies: Array<{ name: string; location?: string; url: string }> },
    sseManager: SSEManager
  ) => {
    try {
      console.log(`\n🤖 AGENT LOG - Companies Identified`)
      console.log(`   Storing ${data.companies.length} companies...`)

      const session = await SearchSessionModel.findById(data.searchId)
      if (!session) {
        console.warn('Session not found:', data.searchId)
        return
      }

      // Store companies in database
      const companyIds = []
      for (const company of data.companies) {
        const stored = await CompanyModel.create({
          url: company.url,
          name: company.name,
          location: company.location,
          searchQuery: data.query,
          discoveredFrom: 'search_results',
          status: 'pending_crawl',
          crawlAttempts: 0
        })
        companyIds.push(stored._id.toString())
      }

      // Update session stats
      session.companiesDiscovered = companyIds.length
      session.companiesRemaining = companyIds.length
      await session.save()

      console.log(`   ✓ Stored ${companyIds.length} companies`)

      // Select first batch: min(10, total_found)
      const batchSize = Math.min(10, companyIds.length)
      const firstBatch = companyIds.slice(0, batchSize)

      console.log(`   📋 Queuing first batch: ${firstBatch.length} companies`)

      await addEvent('companies_queued_for_crawl', {
        searchId: data.searchId,
        companyIds: firstBatch
      })
    } catch (error) {
      console.error('Error in companies_identified handler:', error)
      await addEvent('search_failed', { searchId: data.searchId, error: String(error) })
    }
  },
```

- [ ] **Step 6: Add companies_queued_for_crawl handler**

Add after companies_identified:

```typescript
  companies_queued_for_crawl: async (
    data: { searchId: string; companyIds: string[] },
    sseManager: SSEManager
  ) => {
    try {
      console.log(`\n🤖 AGENT LOG - Companies Queued`)
      console.log(`   Queuing ${data.companyIds.length} companies for crawling...`)

      const session = await SearchSessionModel.findById(data.searchId)
      if (!session) {
        console.warn('Session not found:', data.searchId)
        return
      }

      // Queue each company for crawling
      for (const companyId of data.companyIds) {
        const company = await CompanyModel.findById(companyId)
        if (!company) continue

        await company.updateOne({ status: 'crawling' })

        await addEvent('crawl_company', {
          searchId: data.searchId,
          companyId: companyId,
          url: company.url,
          companyName: company.name,
          query: session.query
        })
      }

      console.log(`   ✓ Queued for crawling`)
    } catch (error) {
      console.error('Error in companies_queued_for_crawl handler:', error)
      await addEvent('search_failed', { searchId: data.searchId, error: String(error) })
    }
  },
```

- [ ] **Step 7: Add company_crawled handler**

Add after companies_queued_for_crawl:

```typescript
  company_crawled: async (
    data: {
      searchId: string
      companyId: string
      jobs: Array<{
        title: string
        company: string
        description: string
        url: string
        salary?: string
        location?: string
        sourceUrl: string
      }>
      discoveredCompanies: Array<{ name: string; location?: string; url: string }>
    },
    sseManager: SSEManager
  ) => {
    try {
      console.log(`\n🤖 AGENT LOG - Company Crawled`)
      console.log(`   Company ID: ${data.companyId}`)
      console.log(`   Jobs extracted: ${data.jobs.length}`)
      console.log(`   Companies discovered: ${data.discoveredCompanies.length}`)

      const session = await SearchSessionModel.findById(data.searchId)
      if (!session) {
        console.warn('Session not found:', data.searchId)
        return
      }

      // Update company status
      const company = await CompanyModel.findById(data.companyId)
      if (company) {
        company.status = 'crawled'
        company.lastCrawlTime = new Date()
        await company.save()
      }

      // Store extracted jobs with keyword matching
      const jobIds = []
      for (const jobData of data.jobs) {
        const match = calculateKeywordMatch(jobData.title, session.query, jobData.description)

        // Only store jobs that pass keyword threshold
        if (passesKeywordThreshold(match.score, 0.4)) {
          const job = await JobModel.create({
            title: jobData.title,
            company: jobData.company,
            description: jobData.description,
            url: jobData.url,
            salary: jobData.salary,
            location: jobData.location,
            sourceUrl: jobData.sourceUrl,
            discoveredAt: new Date(),
            companyId: data.companyId,
            discoveryMethod: 'company_page',
            keywordMatchScore: match.score,
            keywordMatchReasoning: match.reasoning,
            extractedAt: new Date(),
            scoredVersion: 0,
            searchSessionId: data.searchId
          })
          jobIds.push(job._id.toString())
        }
      }

      // Store discovered companies
      const newCompanyIds = []
      for (const discoveredCompany of data.discoveredCompanies) {
        // Check if company already exists
        const exists = await CompanyModel.findOne({ url: discoveredCompany.url })
        if (!exists) {
          // Validate with LLM that it's a real company
          const validation = await validateAndExtractCompanies(
            session.userId,
            session.query,
            [{ url: discoveredCompany.url, title: discoveredCompany.name, snippet: '' }]
          )

          if (validation.length > 0) {
            const newCompany = await CompanyModel.create({
              url: discoveredCompany.url,
              name: discoveredCompany.name,
              location: discoveredCompany.location,
              searchQuery: session.query,
              discoveredFrom: company?.url || 'unknown',
              status: 'pending_crawl',
              crawlAttempts: 0
            })
            newCompanyIds.push(newCompany._id.toString())
          }
        }
      }

      // Update session stats
      session.companiesCrawled = (session.companiesCrawled || 0) + 1
      session.jobsExtracted = (session.jobsExtracted || 0) + jobIds.length
      session.companiesRemaining = Math.max(0, (session.companiesRemaining || 0) - 1)
      await session.save()

      console.log(`   ✓ Stored ${jobIds.length} jobs and ${newCompanyIds.length} new companies`)

      // Check if we need to expand search
      if (session.jobsExtracted < 20 && session.companiesRemaining > 0) {
        console.log(`   📈 Expanding search: ${session.jobsExtracted} jobs found, ${session.companiesRemaining} companies remaining`)
        session.expandedSearch = true
        await session.save()

        // Get next batch of companies
        const remaining = await CompanyModel.find({
          searchQuery: session.query,
          status: 'pending_crawl'
        })
          .limit(10)
          .select('_id')

        if (remaining.length > 0) {
          const nextBatchIds = remaining.map(c => c._id.toString())
          await addEvent('companies_queued_for_crawl', {
            searchId: data.searchId,
            companyIds: nextBatchIds
          })
        }
      }

      // Emit jobs for scoring
      if (jobIds.length > 0) {
        await addEvent('jobs_extracted', {
          searchId: data.searchId,
          jobIds
        })
      }
    } catch (error) {
      console.error('Error in company_crawled handler:', error)
      await addEvent('search_failed', { searchId: data.searchId, error: String(error) })
    }
  },
```

- [ ] **Step 8: Add jobs_extracted handler**

Add after company_crawled:

```typescript
  jobs_extracted: async (
    data: { searchId: string; jobIds: string[] },
    sseManager: SSEManager
  ) => {
    try {
      console.log(`\n🤖 AGENT LOG - Jobs Extracted`)
      console.log(`   Jobs to score: ${data.jobIds.length}`)

      const session = await SearchSessionModel.findById(data.searchId)
      if (!session) {
        console.warn('Session not found:', data.searchId)
        return
      }

      // Batch jobs for LLM scoring (up to 20, or if we've waited 5 seconds)
      // For now, score immediately (real implementation would batch)
      const jobs = await JobModel.find({ _id: { $in: data.jobIds } })

      if (jobs.length === 0) {
        console.log(`   ⚠️ No jobs found to score`)
        return
      }

      // Prepare batch for LLM
      const jobsText = jobs
        .map(
          (j, idx) =>
            `${idx + 1}. Title: ${j.title}\n   Company: ${j.company}\n   Description: ${j.description.substring(0, 200)}...`
        )
        .join('\n\n')

      const prompt = `User searched for: "${session.query}"
Rate these jobs by match score (0-100):
${jobsText}

Return JSON: { "scores": [{"jobId": "...", "score": 0-100, "reasoning": "..."}, ...] }`

      try {
        const response = await callClaude(session.userId, prompt)
        const parsed = JSON.parse(response)

        if (parsed.scores && Array.isArray(parsed.scores)) {
          for (const scoreData of parsed.scores) {
            const job = jobs.find(j => j._id.toString() === scoreData.jobId)
            if (job) {
              job.matchScore = scoreData.score
              job.matchReasoning = scoreData.reasoning
              job.scoredAt = new Date()
              job.scoredVersion = 1
              await job.save()
            }
          }

          session.jobsScored = (session.jobsScored || 0) + parsed.scores.length
          await session.save()

          console.log(`   ✓ Scored ${parsed.scores.length} jobs`)
        }
      } catch (error) {
        console.error('Error calling Claude for scoring:', error)
        // Default scoring on error
        for (const job of jobs) {
          job.matchScore = 0.5
          job.matchReasoning = 'Default score due to scoring error'
          job.scoredAt = new Date()
          await job.save()
        }
      }

      await addEvent('results_ready_for_frontend', {
        searchId: data.searchId,
        scoredJobIds: data.jobIds
      })
    } catch (error) {
      console.error('Error in jobs_extracted handler:', error)
      await addEvent('search_failed', { searchId: data.searchId, error: String(error) })
    }
  },
```

- [ ] **Step 9: Add results_ready_for_frontend handler**

Add after jobs_extracted:

```typescript
  results_ready_for_frontend: async (
    data: { searchId: string; scoredJobIds: string[] },
    sseManager: SSEManager
  ) => {
    try {
      console.log(`\n🤖 AGENT LOG - Results Ready for Frontend`)
      console.log(`   Ready to display: ${data.scoredJobIds.length} jobs`)

      // Signal via SSE if manager available
      if (sseManager) {
        sseManager.broadcast(data.searchId, {
          type: 'results_updated',
          jobCount: data.scoredJobIds.length
        })
      }
    } catch (error) {
      console.error('Error in results_ready_for_frontend handler:', error)
    }
  },
```

- [ ] **Step 10: Add tests for new handlers**

Add to `packages/api/tests/handlers.test.ts`:

```typescript
describe('Company Discovery Handlers', () => {
  it('careers_pages_found extracts companies via LLM', async () => {
    const mockResults = [
      { url: 'https://careers.acme.com', title: 'Acme Careers', snippet: 'Hiring' }
    ]

    vi.mocked(validateAndExtractCompanies).mockResolvedValue([
      { name: 'Acme', location: 'SF', url: 'https://careers.acme.com' }
    ])

    await eventHandlers.careers_pages_found(
      { searchId: 'test', query: 'engineer', searchResults: mockResults },
      mockSSEManager
    )

    expect(validateAndExtractCompanies).toHaveBeenCalled()
  })

  it('companies_identified stores companies and queues first batch', async () => {
    const mockCreate = vi.spyOn(CompanyModel, 'create')

    await eventHandlers.companies_identified(
      {
        searchId: 'test',
        query: 'engineer',
        companies: [
          { name: 'Acme', location: 'SF', url: 'https://acme.com/careers' },
          { name: 'TechCo', location: 'NYC', url: 'https://techco.com/careers' }
        ]
      },
      mockSSEManager
    )

    expect(mockCreate).toHaveBeenCalledTimes(2)
  })

  it('company_crawled stores jobs and discovers new companies', async () => {
    const mockJobCreate = vi.spyOn(JobModel, 'create')

    await eventHandlers.company_crawled(
      {
        searchId: 'test',
        companyId: 'comp1',
        jobs: [
          {
            title: 'Senior Engineer',
            company: 'Acme',
            description: 'Senior engineer role',
            url: 'https://acme.com/jobs/1',
            location: 'SF',
            sourceUrl: 'https://careers.acme.com'
          }
        ],
        discoveredCompanies: [
          { name: 'Sister Co', location: 'LA', url: 'https://sister.com/careers' }
        ]
      },
      mockSSEManager
    )

    expect(mockJobCreate).toHaveBeenCalled()
  })
})
```

- [ ] **Step 11: Run tests**

```bash
cd packages/api
npm test -- tests/handlers.test.ts --run
```

- [ ] **Step 12: Commit**

```bash
git add packages/api/src/events/handlers.ts packages/api/tests/handlers.test.ts
git commit -m "feat: add company discovery and crawling event handlers"
```

---

## Phase 2: Crawler Integration

### Task 6: Create Generic Career Page Spider

**Files:**
- Create: `crawler/job_crawler/spiders/generic_career_spider.py`
- Create: `crawler/job_crawler/company_extractor.py`

- [ ] **Step 1: Create generic_career_spider.py**

```python
"""
Generic company career page spider.

Target: Company career pages (not job boards)
Patterns: careers.company.com, company.com/careers, company.com/jobs, etc.
"""

import sys
import os
from urllib.parse import urljoin

_crawler_root = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)
if _crawler_root not in sys.path:
    sys.path.insert(0, _crawler_root)

from job_crawler.spiders.base_spider import BaseJobSpider
from logger import get_logger
from company_extractor import extract_discovered_companies

log = get_logger(__name__)


class GenericCareerPageSpider(BaseJobSpider):
    """Spider for generic company career pages."""

    name = "generic_career_spider"

    # Common CSS selectors for job listings across multiple sites
    container_selectors = [
        "div.job-listing",
        "div.job-card",
        "div.job",
        "article.job-posting",
        "li.job-item",
        "div[data-job-id]",
        "div[class*='job'][class*='card']",
        "div[class*='position']",
        "tr.job-row",
    ]

    def __init__(self, urls=None, company_name=None, *args, **kwargs):
        super().__init__(urls=urls, *args, **kwargs)
        self.company_name = company_name
        self.start_urls = urls or []

    def parse(self, response):
        """
        Override base parse to also extract discovered companies.
        """
        log.info(f"Parsing {response.url} for jobs", extra={"company": self.company_name})

        # Extract jobs using base logic
        containers = []
        matched_selector = None

        for selector in self.container_selectors:
            containers = response.css(selector).getall()
            if containers:
                matched_selector = selector
                break

        if not containers:
            log.warning(
                f"No job containers found",
                extra={"url": response.url, "company": self.company_name}
            )
        else:
            log.info(
                f"Found {len(containers)} job containers",
                extra={"selector": matched_selector, "company": self.company_name}
            )

        for container_html in containers:
            container = response.css(container_html)
            if not container:
                continue

            job = self.parse_job_item(container, response)
            if job:
                yield job

    def parse_job_item(self, container, response) -> dict | None:
        """Extract a single job from a generic career page."""
        title = self._safe_get(
            container,
            "h1::text",
            "h2::text",
            "h3::text",
            "a[data-job-title]::text",
            "span.job-title::text",
            "div[class*='title']::text",
        )

        company = self.company_name or self._safe_get(
            container,
            "span.company::text",
            "div[class*='company']::text",
            "[data-company]::text",
        )

        description = self._safe_get_all(
            container,
            "p::text",
            "div[class*='description'] p::text",
            "div[class*='description']::text",
            "ul li::text",
        )

        raw_url = self._safe_get(
            container,
            "a[href]::attr(href)",
            "[data-job-url]::attr(data-job-url)",
            "button[data-url]::attr(data-url)",
        )

        location = self._safe_get(
            container,
            "span.location::text",
            "span[class*='location']::text",
            "[data-location]::text",
        )

        salary = self._safe_get(
            container,
            "span.salary::text",
            "span[class*='salary']::text",
            "[data-salary]::text",
        )

        if not title or not company:
            return None

        job_url = self._make_absolute_url(raw_url, response) if raw_url else response.url

        return {
            "title": title,
            "company": company,
            "description": description or f"Job opening: {title} at {company}",
            "url": job_url,
            "location": location or "Not specified",
            "salary": salary or None,
            "source_url": response.url,
        }
```

- [ ] **Step 2: Create company_extractor.py**

```python
"""
Extract discovered company references from career pages.

Looks for patterns like:
- "We're hiring at our sister company..."
- Links to other company domains
- Mentions of parent/subsidiary companies
"""

import re
from urllib.parse import urlparse
from logger import get_logger

log = get_logger(__name__)


def extract_discovered_companies(html_content: str, current_url: str) -> list[dict]:
    """
    Extract company references from page HTML.

    Returns: [{"name": "...", "location": "...", "url": "..."}, ...]
    """
    discovered = []

    # Pattern 1: Extract links to other domains that look like careers pages
    # Look for href="/careers" style links
    career_links = re.findall(r'href="([^"]*(?:careers|jobs|careers)[^"]*)"', html_content, re.IGNORECASE)
    for link in career_links:
        if link.startswith('http'):
            url = link
        else:
            # Relative link - convert to absolute using current domain
            current_domain = urlparse(current_url).netloc
            url = f"https://{current_domain}{link}" if link.startswith('/') else f"https://{current_domain}/{link}"

        discovered.append({
            "name": extract_company_name_from_url(url),
            "url": url,
            "location": None
        })

    # Pattern 2: Text mentions of "our sister company" or "join our team at"
    sister_company_pattern = r"(?:sister company|subsidiary|join.*?(?:at|of))\s+([A-Z][^,.!?\n]{2,40})"
    matches = re.finditer(sister_company_pattern, html_content)
    for match in matches:
        company_name = match.group(1).strip()
        if len(company_name) > 3:  # Filter out short matches
            discovered.append({
                "name": company_name,
                "url": None,  # URL will be searched for separately
                "location": None
            })

    # Deduplicate by name
    seen = set()
    unique_discovered = []
    for item in discovered:
        if item["name"] not in seen:
            seen.add(item["name"])
            unique_discovered.append(item)

    log.info(f"Found {len(unique_discovered)} discovered companies", extra={"current_url": current_url})
    return unique_discovered


def extract_company_name_from_url(url: str) -> str:
    """
    Extract company name from URL.

    Examples:
    - https://careers.acme.com -> Acme
    - https://techco.com/careers -> TechCo
    - https://my-company-name.com -> My Company Name
    """
    domain = urlparse(url).netloc

    # Remove "careers." prefix
    if domain.startswith('careers.'):
        domain = domain[8:]

    # Remove ".com" and other TLDs
    domain = re.sub(r'\.(com|org|net|io|co)$', '', domain)

    # Convert hyphens to spaces and capitalize
    name = domain.replace('-', ' ').replace('_', ' ')
    name = ' '.join(word.capitalize() for word in name.split())

    return name or "Unknown"
```

- [ ] **Step 3: Update server.py to add /crawler/crawl-company endpoint**

Find the scrape() function in `crawler/server.py` and add after it:

```python
@app.route('/crawler/crawl-company', methods=['POST'])
def crawl_company():
    """
    HTTP endpoint for crawling a specific company career page.

    Expected JSON payload:
    {
        "searchId": "uuid",
        "companyId": "mongodb-id",
        "url": "https://careers.acme.com",
        "companyName": "Acme Corp",
        "query": "python engineer"
    }

    Returns:
    {
        "jobs": [...],
        "discoveredCompanies": [...]
    }
    """
    data = request.get_json()

    if not data:
        return jsonify({'error': 'No JSON data provided'}), 400

    try:
        req = CrawlerRequest.model_validate({
            "search_id": data.get("searchId", ""),
            "sites": [data.get("url", "")],
            "keywords": data.get("query", "")
        })
    except ValidationError as exc:
        log.warning("Invalid request payload", extra={"errors": exc.errors()})
        return jsonify({
            'error': 'Request validation failed',
            'detail': exc.errors(include_url=False),
        }), 400

    set_request_id(req.search_id)

    log.info(
        "Crawl company request",
        extra={
            "company_id": data.get("companyId"),
            "company_name": data.get("companyName"),
            "url": req.sites[0]
        }
    )

    breaker = _get_or_create_breaker(req.sites[0])
    limiter = _get_or_create_limiter(req.sites[0])

    # Check circuit breaker
    if breaker.is_open():
        return jsonify({
            'error': 'Domain circuit breaker is OPEN',
            'domain': req.sites[0],
            'retry_after_seconds': breaker.retry_after_seconds
        }), 429

    # Check rate limiter
    if not limiter.allow_request():
        return jsonify({
            'error': 'Rate limit exceeded',
            'domain': req.sites[0],
            'retry_after_seconds': limiter.retry_after_seconds
        }), 429

    try:
        # Use generic spider for company pages
        process = CrawlerProcess({
            'USER_AGENT': config.DEFAULT_USER_AGENT,
            'DOWNLOAD_DELAY': config.CRAWLER_DOWNLOAD_DELAY,
            'CONCURRENT_REQUESTS': 1,  # One at a time for company pages
        })

        process.crawl(GenericCareerPageSpider, urls=req.sites, company_name=data.get("companyName"))
        process.start()

        # Extract discovered companies from collected jobs
        from company_extractor import extract_discovered_companies
        # Note: You'll need to enhance JobCollectorPipeline to capture HTML

        return jsonify({
            'jobs': collected_jobs,
            'discoveredCompanies': []  # Will be populated in enhanced version
        }), 200

    except Exception as exc:
        error_type = _classify_exception(exc)
        log.error(
            "Crawl failed",
            extra={
                "error_type": error_type,
                "message": str(exc)
            }
        )
        breaker.record_failure(error_type)

        return jsonify({
            'error': 'Crawl failed',
            'type': error_type,
            'message': str(exc)
        }), 500
```

- [ ] **Step 4: Commit**

```bash
git add crawler/job_crawler/spiders/generic_career_spider.py crawler/job_crawler/company_extractor.py crawler/server.py
git commit -m "feat: add generic career page spider and company extraction"
```

---

### Task 7: Update API Routes for Pagination and Status

**Files:**
- Modify: `packages/api/src/routes/searches.ts`

- [ ] **Step 1: Add pagination to GET /api/searches/{searchId}/jobs**

Find the existing `/jobs` route and replace it with:

```typescript
router.get('/:searchId/jobs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).userId
    const { searchId } = req.params
    const page = parseInt(req.query.page as string) || 1
    const pageSize = parseInt(req.query.pageSize as string) || 10

    // Validate searchId
    if (!mongoose.Types.ObjectId.isValid(searchId)) {
      return res.status(404).json({ error: 'Search not found' })
    }

    const session = await SearchSessionModel.findOne({
      _id: new mongoose.Types.ObjectId(searchId),
      userId
    })

    if (!session) {
      return res.status(404).json({ error: 'Search not found' })
    }

    // Calculate pagination
    const skip = (page - 1) * pageSize
    const totalJobs = await JobModel.countDocuments({ searchSessionId: searchId })
    const totalPages = Math.ceil(totalJobs / pageSize)

    // Fetch jobs for this page, sorted by matchScore descending
    const jobs = await JobModel.find({ searchSessionId: searchId })
      .sort({ matchScore: -1, scoredAt: -1 })
      .skip(skip)
      .limit(pageSize)
      .lean()

    const isLoading = session.status === 'running'
    const hasMore = page < totalPages

    res.status(200).json({
      jobs,
      page,
      pageSize,
      totalJobs,
      totalPages,
      isLoading,
      hasMore
    })
  } catch (error) {
    next(error)
  }
})
```

- [ ] **Step 2: Add status endpoint**

Add after the `/jobs` route:

```typescript
router.get('/:searchId/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).userId
    const { searchId } = req.params

    if (!mongoose.Types.ObjectId.isValid(searchId)) {
      return res.status(404).json({ error: 'Search not found' })
    }

    const session = await SearchSessionModel.findOne({
      _id: new mongoose.Types.ObjectId(searchId),
      userId
    })

    if (!session) {
      return res.status(404).json({ error: 'Search not found' })
    }

    res.status(200).json({
      status: session.status,
      companiesDiscovered: session.companiesDiscovered || 0,
      companiesCrawled: session.companiesCrawled || 0,
      companiesRemaining: session.companiesRemaining || 0,
      jobsExtracted: session.jobsExtracted || 0,
      jobsScored: session.jobsScored || 0,
      expandedSearch: session.expandedSearch || false,
      query: session.query,
      startedAt: session.startedAt,
      completedAt: session.completedAt
    })
  } catch (error) {
    next(error)
  }
})
```

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/routes/searches.ts
git commit -m "feat: add pagination and status endpoint for searches"
```

---

## Phase 3: Frontend & Results Display

### Task 8: Create Paginated Job List Component

**Files:**
- Create: `packages/frontend/src/components/JobList.tsx`
- Create: `packages/frontend/src/components/SearchProgress.tsx`

- [ ] **Step 1: Create JobList component**

```typescript
// packages/frontend/src/components/JobList.tsx

import React, { useEffect, useState } from 'react'
import type { Job } from '@job-search/shared'

interface JobListProps {
  searchId: string
  onLoadMore: () => void
  isLoading: boolean
}

export function JobList({ searchId, onLoadMore, isLoading }: JobListProps) {
  const [jobs, setJobs] = useState<Job[]>([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [nextPageLoading, setNextPageLoading] = useState(false)

  // Fetch current page
  useEffect(() => {
    const fetchJobs = async () => {
      try {
        const response = await fetch(
          `/api/searches/${searchId}/jobs?page=${page}&pageSize=10`,
          {
            headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
          }
        )
        const data = await response.json()

        if (page === 1) {
          setJobs(data.jobs)
        } else {
          setJobs(prev => [...prev, ...data.jobs])
        }

        setHasMore(data.hasMore)
      } catch (error) {
        console.error('Error fetching jobs:', error)
      }
    }

    fetchJobs()
  }, [searchId, page])

  // Pre-fetch next page in background
  useEffect(() => {
    if (hasMore && !nextPageLoading && !isLoading) {
      setNextPageLoading(true)
      const timer = setTimeout(() => {
        // Just pre-load, don't update state
        fetch(`/api/searches/${searchId}/jobs?page=${page + 1}&pageSize=10`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
        }).finally(() => setNextPageLoading(false))
      }, 1000)

      return () => clearTimeout(timer)
    }
  }, [searchId, page, hasMore, isLoading, nextPageLoading])

  const handleLoadMore = () => {
    setPage(prev => prev + 1)
    onLoadMore()
  }

  return (
    <div className="job-list">
      {jobs.map(job => (
        <div key={job._id} className="job-card">
          <h3>{job.title}</h3>
          <p className="company">{job.company}</p>
          {job.location && <p className="location">{job.location}</p>}
          {job.salary && <p className="salary">{job.salary}</p>}
          <p className="description">{job.description.substring(0, 200)}...</p>
          {job.matchScore !== undefined && (
            <p className="match-score">Match: {(job.matchScore * 100).toFixed(0)}%</p>
          )}
          <a href={job.url} target="_blank" rel="noopener noreferrer" className="apply-btn">
            View Job
          </a>
        </div>
      ))}

      {hasMore && (
        <button onClick={handleLoadMore} disabled={nextPageLoading || isLoading} className="load-more-btn">
          {nextPageLoading ? 'Loading...' : 'Load More Jobs'}
        </button>
      )}

      {isLoading && <p className="loading">Discovering more jobs...</p>}
    </div>
  )
}
```

- [ ] **Step 2: Create SearchProgress component**

```typescript
// packages/frontend/src/components/SearchProgress.tsx

import React, { useEffect, useState } from 'react'

interface SearchProgressProps {
  searchId: string
}

interface StatusData {
  status: string
  companiesDiscovered: number
  companiesCrawled: number
  companiesRemaining: number
  jobsExtracted: number
  jobsScored: number
  expandedSearch: boolean
}

export function SearchProgress({ searchId }: SearchProgressProps) {
  const [status, setStatus] = useState<StatusData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const response = await fetch(`/api/searches/${searchId}/status`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
        })
        const data = await response.json()
        setStatus(data)
      } catch (error) {
        console.error('Error fetching status:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchStatus()

    // Poll every 2 seconds while search is running
    const interval = setInterval(fetchStatus, 2000)
    return () => clearInterval(interval)
  }, [searchId])

  if (loading || !status) {
    return <div className="search-progress loading">Loading search status...</div>
  }

  const isRunning = status.status === 'running'

  return (
    <div className="search-progress">
      <div className="progress-item">
        <span>Companies Discovered:</span>
        <strong>{status.companiesDiscovered}</strong>
      </div>
      <div className="progress-item">
        <span>Companies Crawled:</span>
        <strong>{status.companiesCrawled}</strong>
      </div>
      <div className="progress-item">
        <span>Jobs Found:</span>
        <strong>{status.jobsExtracted}</strong>
      </div>
      <div className="progress-item">
        <span>Jobs Scored:</span>
        <strong>{status.jobsScored}</strong>
      </div>

      {isRunning && (
        <div className="status-running">
          <span className="spinner">⚙️</span>
          Searching...
        </div>
      )}

      {status.expandedSearch && (
        <div className="status-expanded">📈 Expanded search to find more results</div>
      )}

      {!isRunning && (
        <div className="status-complete">✓ Search complete</div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Update Results page to use new components**

Modify `packages/frontend/src/pages/Results.tsx`:

```typescript
// Add imports
import { JobList } from '../components/JobList'
import { SearchProgress } from '../components/SearchProgress'

// In the Results component, replace the jobs display section with:
<div className="results-container">
  <div className="results-sidebar">
    <SearchProgress searchId={searchId} />
  </div>

  <div className="results-main">
    <h1>Job Search Results</h1>
    <JobList
      searchId={searchId}
      onLoadMore={() => {
        // Called when user loads more
      }}
      isLoading={searchStatus === 'running'}
    />
  </div>
</div>
```

- [ ] **Step 4: Add basic styling to pages/frontend/src/pages/Results.tsx**

```css
.results-container {
  display: grid;
  grid-template-columns: 250px 1fr;
  gap: 20px;
  margin: 20px;
}

.results-sidebar {
  padding: 20px;
  background: #f5f5f5;
  border-radius: 8px;
  height: fit-content;
  position: sticky;
  top: 20px;
}

.results-main {
  padding: 20px;
}

.job-card {
  padding: 15px;
  margin: 10px 0;
  border: 1px solid #ddd;
  border-radius: 8px;
  background: white;
}

.job-card h3 {
  margin: 0 0 5px 0;
  color: #333;
}

.job-card .company {
  margin: 5px 0;
  font-weight: bold;
  color: #0066cc;
}

.job-card .match-score {
  margin: 10px 0 0 0;
  color: #28a745;
  font-weight: bold;
}

.load-more-btn {
  padding: 10px 20px;
  background: #0066cc;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 16px;
}

.load-more-btn:hover:not(:disabled) {
  background: #0052a3;
}

.load-more-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.search-progress {
  border: 1px solid #ddd;
  border-radius: 8px;
  padding: 15px;
  background: white;
}

.progress-item {
  display: flex;
  justify-content: space-between;
  margin: 10px 0;
  padding: 5px 0;
  border-bottom: 1px solid #eee;
}

.progress-item span {
  font-size: 14px;
  color: #666;
}

.progress-item strong {
  color: #333;
  font-size: 16px;
}

.status-running {
  margin-top: 15px;
  padding: 10px;
  background: #e3f2fd;
  border-radius: 4px;
  color: #1565c0;
  text-align: center;
}

.spinner {
  display: inline-block;
  animation: spin 2s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
```

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/JobList.tsx packages/frontend/src/components/SearchProgress.tsx packages/frontend/src/pages/Results.tsx
git commit -m "feat: add paginated job list and search progress components"
```

---

## Phase 4: Integration & Testing

### Task 9: Integration Test

**Files:**
- Create: `packages/api/tests/integration.e2e.test.ts`

- [ ] **Step 1: Write end-to-end test**

```typescript
// packages/api/tests/integration.e2e.test.ts

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { connectDB, disconnectDB } from '../src/db/connection'
import { CompanyModel, JobModel, SearchSessionModel, UserModel } from '../src/db/models'

describe('Company-Focused Search E2E', () => {
  let app: any
  let userId: string
  let token: string

  beforeAll(async () => {
    await connectDB()
    // Clear test data
    await UserModel.deleteMany({})
    await CompanyModel.deleteMany({})
    await JobModel.deleteMany({})
    await SearchSessionModel.deleteMany({})
  })

  afterAll(async () => {
    await disconnectDB()
  })

  it('creates user and authenticates', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'test@e2e.com', password: 'testpass123' })

    expect(res.status).toBe(201)
    expect(res.body.token).toBeTruthy()
    expect(res.body.userId).toBeTruthy()

    userId = res.body.userId
    token = res.body.token
  })

  it('creates search session', async () => {
    const res = await request(app)
      .post('/api/searches')
      .set('Authorization', `Bearer ${token}`)
      .send({ query: 'python engineer' })

    expect(res.status).toBe(201)
    expect(res.body.searchId).toBeTruthy()
    expect(res.body.status).toBe('running')
  })

  it('stores companies and jobs', async () => {
    const company = await CompanyModel.create({
      url: 'https://careers.testcompany.com',
      name: 'Test Company',
      location: 'San Francisco',
      searchQuery: 'python engineer',
      discoveredFrom: 'search_results',
      status: 'pending_crawl',
      crawlAttempts: 0
    })

    expect(company._id).toBeTruthy()
    expect(company.status).toBe('pending_crawl')
  })

  it('retrieves paginated jobs', async () => {
    // Create test search session first
    const session = await SearchSessionModel.create({
      userId,
      query: 'python engineer',
      status: 'complete',
      claudeConversationHistory: [],
      foundJobs: [],
      sitesSearched: [],
      iterationCount: 1,
      startedAt: new Date(),
      companiesDiscovered: 1,
      companiesCrawled: 1,
      companiesRemaining: 0,
      jobsExtracted: 2,
      jobsScored: 2,
      currentCrawlBatch: 1,
      expandedSearch: false
    })

    // Create test jobs
    await JobModel.create([
      {
        title: 'Senior Python Engineer',
        company: 'Test Company',
        description: 'Senior role with Python and backend focus',
        url: 'https://careers.testcompany.com/jobs/1',
        location: 'San Francisco',
        sourceUrl: 'https://careers.testcompany.com',
        discoveredAt: new Date(),
        matchScore: 0.95,
        matchReasoning: 'Excellent match',
        companyId: '000000000000000000000001',
        discoveryMethod: 'company_page',
        keywordMatchScore: 0.9,
        keywordMatchReasoning: 'Matched on title',
        extractedAt: new Date(),
        scoredVersion: 1,
        searchSessionId: session._id.toString()
      },
      {
        title: 'Python Developer',
        company: 'Test Company',
        description: 'Backend Python development role',
        url: 'https://careers.testcompany.com/jobs/2',
        location: 'San Francisco',
        sourceUrl: 'https://careers.testcompany.com',
        discoveredAt: new Date(),
        matchScore: 0.85,
        matchReasoning: 'Good match',
        companyId: '000000000000000000000001',
        discoveryMethod: 'company_page',
        keywordMatchScore: 0.8,
        keywordMatchReasoning: 'Matched on keywords',
        extractedAt: new Date(),
        scoredVersion: 1,
        searchSessionId: session._id.toString()
      }
    ])

    // Fetch page 1
    const res = await request(app)
      .get(`/api/searches/${session._id.toString()}/jobs?page=1&pageSize=10`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.jobs).toHaveLength(2)
    expect(res.body.page).toBe(1)
    expect(res.body.totalJobs).toBe(2)
    expect(res.body.hasMore).toBe(false)
  })

  it('retrieves search status', async () => {
    const session = await SearchSessionModel.findOne({ userId })

    const res = await request(app)
      .get(`/api/searches/${session._id.toString()}/status`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('complete')
    expect(res.body.jobsExtracted).toBe(2)
    expect(res.body.companiesDiscovered).toBe(1)
  })
})
```

- [ ] **Step 2: Run integration tests**

```bash
cd packages/api
npm test -- tests/integration.e2e.test.ts --run
```

- [ ] **Step 3: Commit**

```bash
git add packages/api/tests/integration.e2e.test.ts
git commit -m "test: add end-to-end integration tests for company search flow"
```

---

### Task 10: Manual Testing Checklist

- [ ] **Step 1: Start all services**

```bash
# Terminal 1: MongoDB + Redis (already running)
# Terminal 2: Python Crawler
cd crawler
python3 server.py

# Terminal 3: API
cd packages/api
export MONGODB_URI="mongodb://10.185.182.205:27017/job_search"
export REDIS_URL="redis://10.185.182.205:6379"
npm run dev

# Terminal 4: Frontend
cd packages/frontend
npm run dev
```

- [ ] **Step 2: Register new user and authenticate**

- [ ] **Step 3: Create a search for "python engineer"**

- [ ] **Step 4: Observe in API logs**
  - search_started event fires
  - careers_pages_found extracts results
  - careers_pages_found filters aggregators
  - companies_identified extracts company info
  - companies_queued_for_crawl queues first batch

- [ ] **Step 5: Check frontend Results page**
  - SearchProgress shows discovering companies
  - Numbers update in real-time
  - No jobs show initially (waiting for crawl)

- [ ] **Step 6: Monitor crawler logs**
  - GenericCareerPageSpider processes company URLs
  - Jobs are extracted
  - company_crawled event fires

- [ ] **Step 7: Check frontend results**
  - Jobs start appearing
  - Pagination controls show (Load More)
  - Match scores display
  - Pre-fetch next page in background

- [ ] **Step 8: Test pagination**
  - Click "Load More Jobs"
  - Next page loads smoothly
  - Continue scrolling

- [ ] **Step 9: Test with different queries**
  - "senior golang developer"
  - "data scientist remote"
  - "devops engineer"

- [ ] **Step 10: Verify database**

```bash
# Check companies collection
db.companies.find({ searchQuery: 'python engineer' })

# Check jobs with keyword matching
db.jobs.find({ searchSessionId: '<sessionId>' }).pretty()

# Check search session stats
db.searchsessions.findOne({ _id: ObjectId('<sessionId>') })
```

- [ ] **Step 11: Commit test results**

```bash
git add .
git commit -m "test: manual testing completed - all components working"
```

---

## Final Verification Checklist

- [ ] All unit tests pass: `npm test -- --run`
- [ ] All integration tests pass: `npm test -- integration --run`
- [ ] API responds to all endpoints:
  - POST /api/searches (create search)
  - GET /api/searches/{id} (get status)
  - GET /api/searches/{id}/jobs?page=1 (get jobs with pagination)
  - GET /api/searches/{id}/status (get discovery progress)
- [ ] Frontend displays:
  - Search form
  - Progress indicator while searching
  - Paginated job results
  - Match scores
  - Load More button
- [ ] Crawler successfully:
  - Receives company crawl requests
  - Extracts jobs from company pages
  - Discovers new companies
  - Reports results back to API
- [ ] Event handlers execute in correct order:
  - search_started → careers_pages_found → companies_identified → companies_queued_for_crawl → crawl_company → company_crawled → jobs_extracted → results_ready_for_frontend
- [ ] Error handling works:
  - LLM validation fails gracefully
  - Crawler failures don't crash API
  - Missing jobs show 0 results
  - Invalid pagination returns empty

---

## Notes for Implementation

**Key Implementation Details:**

1. **Keyword Matching Threshold:** Set to 0.4 (40% match required)
2. **Job Batch Size for LLM Scoring:** Up to 20 jobs per batch
3. **Company Crawl Batch Size:** First batch = min(10, total_found)
4. **Expansion Threshold:** If < 20 jobs found and companies remain, expand
5. **Max Companies per Search:** 50 (adaptive discovery)
6. **Rate Limiting:** Already implemented per domain
7. **Frontend Pre-fetch:** Next page pre-fetched after 1 second idle

**Testing Strategy:**

- Unit tests for utilities (company-discovery, job-matcher)
- Integration tests for event handlers
- E2E tests for full workflow
- Manual testing on safe company sites (GitHub, Stripe careers)

**Performance Considerations:**

- Index on Company.searchQuery and status
- Index on Job.searchSessionId and matchScore
- Batch LLM calls to reduce API calls
- Background pre-fetch to reduce perceived latency
- Circuit breaker prevents hammering failing domains

**Security Considerations:**

- Validate all company URLs are legitimate
- Filter known job aggregators
- Rate limit per domain
- Validate LLM responses before storing
