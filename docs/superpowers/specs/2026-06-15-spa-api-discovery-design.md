# SPA API Discovery Design

**Date:** 2026-06-15
**Status:** Approved

## Problem

`GenericCareerPageSpider` scrapes static HTML. Modern company career pages (IBM, etc.) are React SPAs: the job container `div` exists in the raw HTML shell but job content is injected by JavaScript. Scrapy gets 0 items.

We cannot write per-site spiders for every company. We have LLM available but calling it on every crawl is too expensive.

## Solution: One-Time LLM-Powered API Discovery

When a React SPA stumps Scrapy, use Playwright to intercept the browser's network traffic and pass the captured JSON API calls to Claude — once, per company. Store the discovered endpoint config in MongoDB. Every future crawl hits the endpoint directly: no Playwright, no LLM.

**Cost profile:** O(number of unknown SPA companies), not O(crawls).

## Architecture

```
crawl_company event
        │
        ▼
CompanyModel has discoveredApi?
  ├─ YES → DirectFetcher hits stored endpoint → company_crawled  (zero LLM cost)
  └─ NO  → call crawler (Scrapy)
                │
                ▼
           Scrapy → jobs found?
             ├─ YES → company_crawled  (existing path, unchanged)
             └─ NO  → Playwright intercepts XHR/fetch traffic
                            │
                            ▼
                    crawler returns { jobs:[], networkCapture:[...], needsDiscovery:true }
                            │
                            ▼
                    API calls Claude (session.userId → user's key)
                    prompt: "which endpoint returns job listings?"
                            │
                            ▼
                    store DiscoveredApiConfig on CompanyModel
                            │
                            ▼
                    DirectFetcher hits discovered endpoint immediately
                            │
                            ▼
                    company_crawled with actual jobs
```

First crawl of an SPA site: ~5–10s slower, one LLM call. All subsequent crawls: fast direct HTTP call, $0.

## Data Models

### CompanyModel (MongoDB) — new field

```typescript
discoveredApi?: {
  endpoint: string        // "https://ibm.wd3.myworkdayjobs.com/api/jobs"
  method: 'GET' | 'POST'
  paramTemplate: object   // { searchText: '{keywords}', limit: 50 }
  fieldMapping: {         // dot-paths into each item in the jobs array
    title: string
    url: string
    location: string
    description: string
  }
  platform?: string       // 'workday' | 'greenhouse' | 'lever' | 'custom'
  discoveredAt: Date
}
```

`{keywords}` is a literal placeholder replaced at fetch time with the user's search query.

### CompanyCrawlResult (Python Pydantic) — new fields

```python
class CapturedRequest(BaseModel):
    url: str
    method: str
    response_body: str   # JSON string, truncated to 3KB
    response_status: int

# added to CompanyCrawlResult:
network_capture: list[CapturedRequest] = []
needs_discovery: bool = False
```

`network_capture` is only populated when Scrapy returns 0 items.

## Files to Create / Modify

### Crawler (Python)

| File | Change |
|------|--------|
| `crawler/requirements.txt` | add `playwright` |
| `crawler/models.py` | add `CapturedRequest`; add `network_capture` + `needs_discovery` to `CompanyCrawlResult` |
| `crawler/job_crawler/network_interceptor.py` | **NEW** — Playwright async network capture |
| `crawler/cli.py` | `_run_company_crawl_worker`: when `collected_jobs` is empty after Scrapy, run `capture_job_api_calls(url)` and include result in queue payload |

### API (TypeScript)

| File | Change |
|------|--------|
| `packages/api/src/db/models.ts` | add `discoveredApi` subdocument to `CompanyModel` schema |
| `packages/api/src/discovery/api-discoverer.ts` | **NEW** — takes `networkCapture[]`, calls `callClaude`, returns `DiscoveredApiConfig \| null` |
| `packages/api/src/discovery/direct-fetcher.ts` | **NEW** — given `DiscoveredApiConfig + keywords`, fetches endpoint, maps dot-path fields, returns `JobData[]` |
| `packages/api/src/events/handlers.ts` | `crawl_company` handler: check `discoveredApi` before calling crawler; handle `needsDiscovery` response |

## Key Implementation Details

### NetworkInterceptor (Python)

```python
async def capture_job_api_calls(url: str) -> list[CapturedRequest]:
    # Launches Chromium headless, navigates to URL, waits for networkidle
    # Intercepts all responses with content-type: application/json
    # Filters with _looks_like_job_list():
    #   - top-level array with ≥2 items, OR
    #   - dict with key in (jobs|postings|positions|results|data|items|requisitions)
    #     containing a list with ≥2 items
    # Truncates response body to 3KB
    # Returns up to 5 candidates (all that pass filter, first 5 sent to LLM)
```

### LLM Prompt (API)

Sends up to 5 candidate requests to Claude. Requires JSON-only response with:
- `endpoint` — base URL, no query params
- `method` — GET or POST
- `paramTemplate` — query params with `{keywords}` placeholder for search term
- `fieldMapping` — dot-notation paths for title, url, location, description
- `platform` — detected ATS platform name
- `confidence` — 0.0–1.0

Discovery is abandoned if `confidence < 0.6` — falls back to 0 jobs rather than storing a wrong config.

### DirectFetcher (TypeScript)

```typescript
function get(obj: any, path: string): string
// Resolves "primaryLocation.city" → obj.primaryLocation.city

function extractArray(data: any): any[]
// Handles: top-level array, or { jobs:[...] }, { data:[...] }, etc.

function buildParams(template: object, keywords: string): URLSearchParams
// Replaces '{keywords}' placeholder in template values
```

Jobs with `title.length < 10` are dropped (matches existing `JobData` validator).

### Re-discovery

If a company's API changes and `DirectFetcher` returns 0 jobs, the `crawl_company` handler clears `discoveredApi` from `CompanyModel` and falls through to the normal Scrapy → Playwright → LLM path. The next crawl overwrites the stored config with a freshly discovered one.

## Error Handling

| Failure | Behaviour |
|---------|-----------|
| Playwright times out | returns `network_capture: []`, `needs_discovery: false` — falls through to 0-jobs result |
| Claude returns invalid JSON | discovery returns `null` — falls through to 0-jobs result |
| Claude confidence < 0.6 | discovery returns `null` — falls through to 0-jobs result |
| DirectFetcher HTTP error | throws — caught by `crawl_company` handler, company marked `failed` |
| Field mapping misses a path | field defaults to `''` — job dropped by title-length validator |

## Testing

- Unit test `_looks_like_job_list` with array, nested dict, and non-job JSON
- Unit test `get(obj, path)` with shallow and deep dot-paths
- Unit test `extractArray` with all supported shapes
- Unit test `buildParams` replaces `{keywords}` correctly
- Integration test: mock Playwright response → verify `CompanyCrawlResult.needsDiscovery = true`
- Integration test: mock LLM response → verify `CompanyModel.discoveredApi` stored correctly
- Integration test: company with `discoveredApi` → crawler not called, direct fetch used
