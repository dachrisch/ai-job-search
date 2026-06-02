# Crawler Service Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the Node.js WebScraper with a CrawlerSource that calls the Python crawler service.

**Status:** All Tasks Complete.

**Architecture:** Refactor the JobSource interface to support bulk scraping, implement a specialized HTTP client for the Python service, and update orchestrating event handlers to pass exact URLs.

**Tech Stack:** TypeScript, Node.js, Axios, Vitest

---

### Task 1: Update JobSource Interface

**Files:**
- Modify: `packages/api/src/job-sources/interfaces.ts`

**Step 1: Update JobSource and ScrapingResult interfaces**

```typescript
// packages/api/src/job-sources/interfaces.ts

export interface JobSource {
  name: string
  canHandle(domain: string): boolean
  // New bulk method
  scrapeBulk(urls: string[], keywords: string, config?: JobSourceConfig): Promise<JobScraperResult[]>
  // Deprecating single scrape
  scrape(url: string, keywords: string, config?: JobSourceConfig): Promise<JobScraperResult>
}
```

**Step 2: Verify TypeScript compilation**

Run: `npm run build` from `packages/api`
Expected: FAIL - TypeScript errors in `MockSource`, `WebScraper`, and `JobSourceManager` (which we will fix in subsequent tasks).

**Step 3: Commit**

```bash
git add packages/api/src/job-sources/interfaces.ts
git commit -m "refactor: update JobSource interface for bulk scraping"
```

### Task 2: Implement CrawlerSource

**Files:**
- Create: `packages/api/src/job-sources/crawler-source.ts`
- Create: `packages/api/src/job-sources/__tests__/crawler-source.test.ts`

**Step 1: Write failing test for CrawlerSource**

```typescript
// packages/api/src/job-sources/__tests__/crawler-source.test.ts
import { describe, it, expect, vi } from 'vitest'
import { CrawlerSource } from '../crawler-source'
import axios from 'axios'

vi.mock('axios')

describe('CrawlerSource', () => {
  const source = new CrawlerSource()

  it('should call Python crawler service with correct payload', async () => {
    const mockResponse = {
      data: [
        {
          source: 'linkedin.com',
          jobs: [{ title: 'Test Job', company: 'Test Co', url: 'https://test.com', sourceUrl: 'https://test.com' }],
          errors: []
        }
      ]
    }
    vi.mocked(axios.post).mockResolvedValue(mockResponse)

    const results = await source.scrapeBulk(['https://linkedin.com/jobs/123'], 'node engineer')
    
    expect(axios.post).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      sites: ['https://linkedin.com/jobs/123'],
      keywords: 'node engineer'
    }))
    expect(results[0].jobs[0].title).toBe('Test Job')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npm test -- crawler-source.test.ts --run`
Expected: FAIL - "CrawlerSource is not defined"

**Step 3: Implement CrawlerSource**

```typescript
// packages/api/src/job-sources/crawler-source.ts
import axios from 'axios'
import { JobSource, JobScraperResult, JobSourceConfig } from './interfaces.js'

export class CrawlerSource implements JobSource {
  name = 'CrawlerSource'
  private serviceUrl = process.env.CRAWLER_SERVICE_URL || 'http://localhost:5000'

  canHandle(domain: string): boolean {
    return true // Python service handles domain routing internally
  }

  async scrapeBulk(urls: string[], keywords: string, config?: JobSourceConfig): Promise<JobScraperResult[]> {
    try {
      const response = await axios.post(`${this.serviceUrl}/crawler/scrape`, {
        sites: urls,
        keywords,
        config: {
          timeout: config?.timeout || 30000,
          maxRetries: config?.maxRetries || 3
        }
      }, { timeout: 35000 })

      return response.data.map((result: any) => ({
        source: result.source || 'CrawlerSource',
        jobs: result.jobs || [],
        errors: result.errors || [],
        timestamp: new Date()
      }))
    } catch (error: any) {
      console.error('CrawlerSource failed:', error.message)
      return urls.map(url => ({
        source: 'CrawlerSource',
        jobs: [],
        errors: [{ message: `Crawler service error: ${error.message}`, site: url }],
        timestamp: new Date()
      }))
    }
  }

  // Implementation for backward compatibility during transition
  async scrape(url: string, keywords: string, config?: JobSourceConfig): Promise<JobScraperResult> {
    const results = await this.scrapeBulk([url], keywords, config)
    return results[0]
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- crawler-source.test.ts --run`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/api/src/job-sources/crawler-source.ts packages/api/src/job-sources/__tests__/crawler-source.test.ts
git commit -m "feat: implement CrawlerSource to integrate with Python crawler"
```

### Task 3: Update JobSourceManager & MockSource

**Files:**
- Modify: `packages/api/src/job-sources/mock-source.ts`
- Modify: `packages/api/src/job-sources/manager.ts`

**Step 1: Implement scrapeBulk in MockSource**

```typescript
// packages/api/src/job-sources/mock-source.ts (add method)
  async scrapeBulk(urls: string[], keywords: string, config?: JobSourceConfig): Promise<JobScraperResult[]> {
    return Promise.all(urls.map(url => this.scrape(url, keywords, config)))
  }
```

**Step 2: Update JobSourceManager to use CrawlerSource exclusively**

```typescript
// packages/api/src/job-sources/manager.ts

import { JobSource, JobScraperResult, JobSourceConfig } from './interfaces.js'
import { CrawlerSource } from './crawler-source.js'
import { MockSource } from './mock-source.js'

export class JobSourceManager {
  private sources: JobSource[] = []

  constructor() {
    this.initializeSources()
  }

  private initializeSources(): void {
    this.sources = [
      new CrawlerSource(), // Primary
      new MockSource()    // Fallback
    ]
  }

  async scrapeJobs(urls: string[], keywords: string, config?: JobSourceConfig): Promise<JobScraperResult[]> {
    const crawler = this.sources.find(s => s instanceof CrawlerSource)
    if (crawler) {
      return crawler.scrapeBulk(urls, keywords, config)
    }
    return []
  }
}
```

**Step 3: Run existing manager tests**

Run: `npm test -- manager.test.ts --run`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/api/src/job-sources/mock-source.ts packages/api/src/job-sources/manager.ts
git commit -m "refactor: update JobSourceManager to use CrawlerSource"
```

### Task 4: Update Event Handlers for URL Precision

**Files:**
- Modify: `packages/api/src/events/handlers.ts`

**Step 1: Update pages_analyzed handler to pass full URLs**

```typescript
// packages/api/src/events/handlers.ts

  pages_analyzed: async (
    data: { searchId: string; query: string; results: SearchResult[] },
    sseManager: SSEManager
  ) => {
    // ... existing analyzer code ...
    const analyzedPages = await pageAnalyzer.analyzePages(...)
    
    session.discoveredPages = analyzedPages.map(p => p.url)
    await session.save()

    await addEvent('crawl_requested', {
      searchId: data.searchId,
      sites: analyzedPages.map(p => p.url), // CHANGE: Pass full URLs, not just domains
      keywords: data.query
    })
  }
```

**Step 2: Commit**

```bash
git add packages/api/src/events/handlers.ts
git commit -m "feat: pass exact URLs to crawl_requested event"
```

### Task 5: Cleanup Obsolete Scraper

**Files:**
- Delete: `packages/api/src/job-sources/web-scraper.ts`
- Delete: `packages/api/src/job-sources/__tests__/web-scraper.test.ts`

**Step 1: Remove WebScraper files**

```bash
rm packages/api/src/job-sources/web-scraper.ts
rm packages/api/src/job-sources/__tests__/web-scraper.test.ts
```

**Step 2: Final Verification**

Run: `npm test --run` in `packages/api`
Expected: All tests pass (except integration tests if SearXNG is down)

**Step 3: Commit**

```bash
git commit -m "cleanup: remove obsolete Node.js WebScraper"
```
