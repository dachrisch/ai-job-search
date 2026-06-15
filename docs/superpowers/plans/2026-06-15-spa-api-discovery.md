# SPA API Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When Scrapy returns 0 jobs from a career page, launch Playwright to capture the SPA's hidden JSON API calls, send them to Claude once, store the discovered endpoint in MongoDB, and use it for all future crawls — eliminating per-site spider code.

**Architecture:** Playwright runs in the Python crawler subprocess and returns captured network traffic in `CompanyCrawlResult`. The Node.js API handler calls Claude with that traffic to extract an endpoint config, stores it on `CompanyModel.discoveredApi`, then immediately fetches jobs from the discovered endpoint. Future crawls skip the crawler entirely and call the stored endpoint directly.

**Tech Stack:** Python/Playwright (network capture), Scrapy (existing static HTML path), Node.js/TypeScript (API handler, LLM call, direct fetch), Vitest (API tests), pytest + pytest-asyncio (crawler tests), MongoDB/Mongoose (config storage).

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/shared/src/types.ts` | Modify | Add `DiscoveredApiConfig` interface + `discoveredApi` field to `Company` |
| `packages/api/src/db/models.ts` | Modify | Add `discoveredApi` subdocument to `companySchema` |
| `packages/api/src/discovery/direct-fetcher.ts` | Create | `get()`, `extractArray()`, `buildParams()`, `fetchFromDiscoveredApi()` |
| `packages/api/src/discovery/__tests__/direct-fetcher.test.ts` | Create | Unit tests for all DirectFetcher functions |
| `packages/api/src/discovery/api-discoverer.ts` | Create | `discoverJobsApi()` — calls Claude, parses config, validates confidence |
| `packages/api/src/discovery/__tests__/api-discoverer.test.ts` | Create | Unit tests with mocked `callClaude` |
| `packages/api/src/events/handlers.ts` | Modify | `crawl_company`: fast path, discovery path, re-discovery path |
| `packages/api/src/events/__tests__/crawl-company-handler.test.ts` | Create | Handler unit tests for all three paths |
| `crawler/models.py` | Modify | Add `CapturedRequest`; add `network_capture` + `needs_discovery` to `CompanyCrawlResult` |
| `crawler/tests/__init__.py` | Create | Empty — makes `tests/` a package |
| `crawler/tests/test_models.py` | Create | Tests for `CapturedRequest` and updated `CompanyCrawlResult` |
| `crawler/job_crawler/network_interceptor.py` | Create | `_looks_like_job_list()`, `capture_job_api_calls()` |
| `crawler/tests/test_network_interceptor.py` | Create | Tests for `_looks_like_job_list` |
| `crawler/cli.py` | Modify | `_run_company_crawl_worker`: Playwright fallback when Scrapy returns 0 |
| `crawler/requirements.txt` | Modify | Add `playwright`, `pytest`, `pytest-asyncio` |
| `crawler/Dockerfile` | Modify | Add `playwright install chromium` after pip install |

---

### Task 1: Add `DiscoveredApiConfig` to shared types

**Files:**
- Modify: `packages/shared/src/types.ts`

- [ ] **Step 1: Add the interface and update Company**

Open `packages/shared/src/types.ts`. Add the new interface before the `Company` interface, then add `discoveredApi` as an optional field on `Company`:

```typescript
export interface DiscoveredApiConfig {
  endpoint: string
  method: 'GET' | 'POST'
  paramTemplate: Record<string, any>
  fieldMapping: {
    title: string
    url: string
    location: string
    description: string
  }
  platform?: string
  discoveredAt: Date
}

export interface Company {
  _id: string
  url: string
  name: string
  location?: string
  industry?: string
  searchQuery: string
  discoveredFrom: 'searxng' | 'manual'
  confidence?: 'high' | 'medium' | 'low'
  status: 'pending_crawl' | 'crawling' | 'crawled' | 'failed'
  crawlAttempts: number
  lastCrawlTime?: Date
  discoveredApi?: DiscoveredApiConfig   // ← new field
  createdAt: Date
  updatedAt: Date
}
```

- [ ] **Step 2: Rebuild shared package**

```bash
npm run build --workspace=@job-search/shared
```

Expected: exits 0, no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/types.ts
git commit -m "feat(shared): add DiscoveredApiConfig type and Company.discoveredApi field"
```

---

### Task 2: Add `discoveredApi` to CompanyModel schema

**Files:**
- Modify: `packages/api/src/db/models.ts`

- [ ] **Step 1: Add subdocument to companySchema**

In `packages/api/src/db/models.ts`, replace the `companySchema` definition with:

```typescript
const discoveredApiSchema = new Schema({
  endpoint: { type: String, required: true },
  method: { type: String, enum: ['GET', 'POST'], required: true },
  paramTemplate: { type: Schema.Types.Mixed, required: true },
  fieldMapping: {
    title: { type: String, required: true },
    url: { type: String, required: true },
    location: { type: String, required: true },
    description: { type: String, required: true },
  },
  platform: { type: String },
  discoveredAt: { type: Date, required: true },
}, { _id: false })

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
      default: 'pending_crawl',
    },
    crawlAttempts: { type: Number, default: 0 },
    lastCrawlTime: { type: Date },
    discoveredApi: { type: discoveredApiSchema },   // ← new field
  },
  { timestamps: true }
)
```

- [ ] **Step 2: Verify TypeScript builds**

```bash
npm run build --workspace=@job-search/api
```

Expected: exits 0, no errors about `discoveredApi`.

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/db/models.ts
git commit -m "feat(api): add discoveredApi subdocument to CompanyModel schema"
```

---

### Task 3: DirectFetcher utility functions

**Files:**
- Create: `packages/api/src/discovery/direct-fetcher.ts`
- Create: `packages/api/src/discovery/__tests__/direct-fetcher.test.ts`

- [ ] **Step 1: Write failing tests for utility functions**

Create `packages/api/src/discovery/__tests__/direct-fetcher.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { get, extractArray, buildParams } from '../direct-fetcher.js'

describe('get', () => {
  it('resolves shallow path', () => {
    expect(get({ title: 'Engineer' }, 'title')).toBe('Engineer')
  })

  it('resolves nested dot path', () => {
    expect(get({ primaryLocation: { city: 'Berlin' } }, 'primaryLocation.city')).toBe('Berlin')
  })

  it('returns empty string for missing key', () => {
    expect(get({ a: 1 }, 'b')).toBe('')
  })

  it('returns empty string for empty path', () => {
    expect(get({ a: 1 }, '')).toBe('')
  })

  it('returns empty string when intermediate key missing', () => {
    expect(get({ a: {} }, 'a.b.c')).toBe('')
  })
})

describe('extractArray', () => {
  it('returns top-level array directly', () => {
    const arr = [{ id: 1 }, { id: 2 }]
    expect(extractArray(arr)).toBe(arr)
  })

  it('finds jobs key', () => {
    const jobs = [{ id: 1 }]
    expect(extractArray({ jobs })).toBe(jobs)
  })

  it('finds postings key', () => {
    const postings = [{ id: 1 }]
    expect(extractArray({ postings })).toBe(postings)
  })

  it('finds data key', () => {
    const data = [{ id: 1 }]
    expect(extractArray({ meta: 'x', data })).toBe(data)
  })

  it('falls back to first array value when no known key', () => {
    const items = [{ id: 1 }]
    expect(extractArray({ unknownKey: items })).toBe(items)
  })

  it('returns empty array when no array found', () => {
    expect(extractArray({ foo: 'bar' })).toEqual([])
  })
})

describe('buildParams', () => {
  it('replaces {keywords} placeholder', () => {
    const result = buildParams({ q: '{keywords}', limit: 20 }, 'python engineer')
    expect(result).toEqual({ q: 'python engineer', limit: '20' })
  })

  it('leaves non-placeholder values unchanged', () => {
    const result = buildParams({ limit: 50, offset: 0 }, 'anything')
    expect(result).toEqual({ limit: '50', offset: '0' })
  })

  it('handles empty template', () => {
    expect(buildParams({}, 'query')).toEqual({})
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd packages/api && npm test -- --run --reporter=verbose 2>&1 | grep -A3 "direct-fetcher"
```

Expected: fails with "Cannot find module '../direct-fetcher.js'"

- [ ] **Step 3: Implement the utility functions**

Create `packages/api/src/discovery/direct-fetcher.ts`:

```typescript
import type { DiscoveredApiConfig } from '@job-search/shared'

export interface FetchedJob {
  title: string
  company: string
  location: string
  url: string
  description: string
  sourceUrl: string   // camelCase — matches JobModel schema field name
}

export function get(obj: any, path: string): string {
  if (!path) return ''
  const value = path.split('.').reduce((o: any, k: string) => o?.[k], obj)
  return value != null ? String(value) : ''
}

const ARRAY_KEYS = ['jobs', 'postings', 'positions', 'results', 'data', 'items', 'requisitions']

export function extractArray(data: any): any[] {
  if (Array.isArray(data)) return data
  for (const key of ARRAY_KEYS) {
    if (data[key] && Array.isArray(data[key])) return data[key]
  }
  for (const val of Object.values(data)) {
    if (Array.isArray(val) && (val as any[]).length > 0) return val as any[]
  }
  return []
}

export function buildParams(template: Record<string, any>, keywords: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(template)) {
    result[key] = String(value).replace('{keywords}', keywords)
  }
  return result
}

export async function fetchFromDiscoveredApi(
  config: DiscoveredApiConfig,
  keywords: string,
  companyName: string,
  careerUrl: string
): Promise<FetchedJob[]> {
  const params = buildParams(config.paramTemplate, keywords)
  const queryString = new URLSearchParams(params).toString()
  const fullUrl = queryString ? `${config.endpoint}?${queryString}` : config.endpoint

  const res = await fetch(fullUrl, { method: config.method })
  if (!res.ok) {
    throw new Error(`DirectFetcher: HTTP ${res.status} from ${config.endpoint}`)
  }
  const data = await res.json()
  const items = extractArray(data)

  return items
    .map((item: any) => ({
      title: get(item, config.fieldMapping.title),
      company: companyName,
      location: get(item, config.fieldMapping.location) || 'Not specified',
      url: get(item, config.fieldMapping.url) || careerUrl,
      description: get(item, config.fieldMapping.description) || `Job opening at ${companyName}`,
      sourceUrl: careerUrl,
    }))
    .filter((j: FetchedJob) => j.title.length >= 10)
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd packages/api && npm test -- --run --reporter=verbose 2>&1 | grep -E "(PASS|FAIL|✓|✗|direct-fetcher)"
```

Expected: all `direct-fetcher` tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/discovery/direct-fetcher.ts packages/api/src/discovery/__tests__/direct-fetcher.test.ts
git commit -m "feat(api): add DirectFetcher with get/extractArray/buildParams utilities"
```

---

### Task 4: `fetchFromDiscoveredApi` integration test

**Files:**
- Modify: `packages/api/src/discovery/__tests__/direct-fetcher.test.ts`

- [ ] **Step 1: Add test for `fetchFromDiscoveredApi` with mocked fetch**

Append to `packages/api/src/discovery/__tests__/direct-fetcher.test.ts`:

```typescript
import { vi, beforeEach, afterEach } from 'vitest'
import { fetchFromDiscoveredApi } from '../direct-fetcher.js'
import type { DiscoveredApiConfig } from '@job-search/shared'

const CONFIG: DiscoveredApiConfig = {
  endpoint: 'https://example.com/api/jobs',
  method: 'GET',
  paramTemplate: { q: '{keywords}', limit: 10 },
  fieldMapping: { title: 'requisitionTitle', url: 'externalUrl', location: 'city', description: 'summary' },
  discoveredAt: new Date(),
}

describe('fetchFromDiscoveredApi', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fetches, maps fields, and drops short titles', async () => {
    const mockData = {
      jobs: [
        { requisitionTitle: 'Senior Engineer', externalUrl: 'https://example.com/jobs/1', city: 'Berlin', summary: 'Great role.' },
        { requisitionTitle: 'Dev', externalUrl: 'https://example.com/jobs/2', city: 'Remote', summary: 'Short.' },
      ],
    }
    ;(global.fetch as any).mockResolvedValue({ ok: true, json: async () => mockData })

    const jobs = await fetchFromDiscoveredApi(CONFIG, 'engineer', 'Acme', 'https://acme.com/careers')

    expect(jobs).toHaveLength(1)
    expect(jobs[0].title).toBe('Senior Engineer')
    expect(jobs[0].company).toBe('Acme')
    expect(jobs[0].location).toBe('Berlin')
    expect(jobs[0].source_url).toBe('https://acme.com/careers')
  })

  it('throws on non-ok HTTP response', async () => {
    ;(global.fetch as any).mockResolvedValue({ ok: false, status: 403 })
    await expect(
      fetchFromDiscoveredApi(CONFIG, 'query', 'Acme', 'https://acme.com/careers')
    ).rejects.toThrow('HTTP 403')
  })

  it('injects keywords into query params', async () => {
    ;(global.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ jobs: [] }) })
    await fetchFromDiscoveredApi(CONFIG, 'python developer', 'Acme', 'https://acme.com/careers')
    const calledUrl = (global.fetch as any).mock.calls[0][0] as string
    expect(calledUrl).toContain('q=python+developer')
  })
})
```

- [ ] **Step 2: Run tests**

```bash
cd packages/api && npm test -- --run --reporter=verbose 2>&1 | grep -E "(PASS|FAIL|✓|✗|fetchFromDiscoveredApi)"
```

Expected: all three new tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/discovery/__tests__/direct-fetcher.test.ts
git commit -m "test(api): add fetchFromDiscoveredApi tests with mocked fetch"
```

---

### Task 5: `ApiDiscoverer`

**Files:**
- Create: `packages/api/src/discovery/api-discoverer.ts`
- Create: `packages/api/src/discovery/__tests__/api-discoverer.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/api/src/discovery/__tests__/api-discoverer.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../claude/client.js', () => ({
  callClaude: vi.fn(),
}))

import { discoverJobsApi } from '../api-discoverer.js'
import { callClaude } from '../../claude/client.js'

const CAPTURE = [
  {
    url: 'https://ibm.wd3.myworkdayjobs.com/api/jobs?limit=20',
    method: 'GET',
    responseBody: JSON.stringify({ jobs: [{ title: 'Engineer', city: 'Berlin' }] }),
    responseStatus: 200,
  },
]

describe('discoverJobsApi', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns config when Claude returns valid JSON with high confidence', async () => {
    const claudeResponse = JSON.stringify({
      endpoint: 'https://ibm.wd3.myworkdayjobs.com/api/jobs',
      method: 'GET',
      paramTemplate: { searchText: '{keywords}', limit: 50 },
      fieldMapping: { title: 'title', url: 'externalUrl', location: 'city', description: 'summary' },
      platform: 'workday',
      confidence: 0.9,
    })
    vi.mocked(callClaude).mockResolvedValue(claudeResponse)

    const config = await discoverJobsApi('user1', 'IBM', 'https://ibm.com/careers', CAPTURE)

    expect(config).not.toBeNull()
    expect(config!.endpoint).toBe('https://ibm.wd3.myworkdayjobs.com/api/jobs')
    expect(config!.platform).toBe('workday')
    expect(config!.discoveredAt).toBeInstanceOf(Date)
  })

  it('returns null when confidence is below 0.6', async () => {
    vi.mocked(callClaude).mockResolvedValue(JSON.stringify({
      endpoint: 'https://ibm.com/api/jobs',
      method: 'GET',
      paramTemplate: {},
      fieldMapping: { title: 'title', url: 'url', location: 'loc', description: 'desc' },
      confidence: 0.4,
    }))

    const config = await discoverJobsApi('user1', 'IBM', 'https://ibm.com/careers', CAPTURE)
    expect(config).toBeNull()
  })

  it('returns null when Claude returns invalid JSON', async () => {
    vi.mocked(callClaude).mockResolvedValue('Sorry, I cannot determine the API.')
    const config = await discoverJobsApi('user1', 'IBM', 'https://ibm.com/careers', CAPTURE)
    expect(config).toBeNull()
  })

  it('returns null when callClaude throws', async () => {
    vi.mocked(callClaude).mockRejectedValue(new Error('API timeout'))
    const config = await discoverJobsApi('user1', 'IBM', 'https://ibm.com/careers', CAPTURE)
    expect(config).toBeNull()
  })

  it('strips markdown code fences from Claude response', async () => {
    const json = JSON.stringify({
      endpoint: 'https://ibm.com/api/jobs',
      method: 'GET',
      paramTemplate: { q: '{keywords}' },
      fieldMapping: { title: 'title', url: 'url', location: 'loc', description: 'desc' },
      confidence: 0.8,
    })
    vi.mocked(callClaude).mockResolvedValue('```json\n' + json + '\n```')

    const config = await discoverJobsApi('user1', 'IBM', 'https://ibm.com/careers', CAPTURE)
    expect(config).not.toBeNull()
    expect(config!.endpoint).toBe('https://ibm.com/api/jobs')
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd packages/api && npm test -- --run --reporter=verbose 2>&1 | grep -E "(PASS|FAIL|✓|✗|api-discoverer)"
```

Expected: fails with "Cannot find module '../api-discoverer.js'"

- [ ] **Step 3: Implement `ApiDiscoverer`**

Create `packages/api/src/discovery/api-discoverer.ts`:

```typescript
import { callClaude } from '../claude/client.js'
import type { DiscoveredApiConfig } from '@job-search/shared'

interface CapturedRequest {
  url: string
  method: string
  responseBody: string
  responseStatus: number
}

export async function discoverJobsApi(
  userId: string,
  companyName: string,
  careerUrl: string,
  networkCapture: CapturedRequest[]
): Promise<DiscoveredApiConfig | null> {
  const candidates = networkCapture.slice(0, 5)
  const candidateText = candidates
    .map(
      (r, i) => `
--- Request ${i + 1} ---
URL: ${r.url}
Method: ${r.method}
Response preview: ${r.responseBody.slice(0, 1500)}
`
    )
    .join('\n')

  const prompt = `Company: ${companyName}
Career page: ${careerUrl}

This career page is a JavaScript SPA. Here are the JSON API calls the browser made:
${candidateText}

Which endpoint returns the job listings? Respond with ONLY valid JSON, no other text:
{
  "endpoint": "base URL without query parameters",
  "method": "GET",
  "paramTemplate": { "searchText": "{keywords}", "limit": 50 },
  "fieldMapping": { "title": "dot.path", "url": "dot.path", "location": "dot.path", "description": "dot.path" },
  "platform": "workday|greenhouse|lever|custom",
  "confidence": 0.0
}`

  let raw: string
  try {
    raw = await callClaude(userId, prompt)
  } catch (err) {
    console.warn('discoverJobsApi: callClaude failed:', err)
    return null
  }

  let config: any
  try {
    const cleaned = raw
      .replace(/^```json\s*/m, '')
      .replace(/^```\s*/m, '')
      .replace(/```\s*$/m, '')
    config = JSON.parse(cleaned)
  } catch {
    console.warn('discoverJobsApi: Claude returned invalid JSON:', raw.slice(0, 200))
    return null
  }

  if (!config.confidence || config.confidence < 0.6) {
    console.warn('discoverJobsApi: low confidence', config.confidence)
    return null
  }

  return {
    endpoint: config.endpoint,
    method: config.method || 'GET',
    paramTemplate: config.paramTemplate || {},
    fieldMapping: config.fieldMapping,
    platform: config.platform,
    discoveredAt: new Date(),
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd packages/api && npm test -- --run --reporter=verbose 2>&1 | grep -E "(PASS|FAIL|✓|✗|api-discoverer)"
```

Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/discovery/api-discoverer.ts packages/api/src/discovery/__tests__/api-discoverer.test.ts
git commit -m "feat(api): add ApiDiscoverer — LLM-powered SPA endpoint discovery"
```

---

### Task 6: Python `CapturedRequest` model

**Files:**
- Modify: `crawler/models.py`
- Create: `crawler/tests/__init__.py`
- Create: `crawler/tests/test_models.py`

- [ ] **Step 1: Write failing Python tests**

```bash
mkdir -p /home/cda/dev/job-search/crawler/tests
touch /home/cda/dev/job-search/crawler/tests/__init__.py
```

Create `crawler/tests/test_models.py`:

```python
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import pytest
from models import CapturedRequest, CompanyCrawlResult


def test_captured_request_snake_case():
    r = CapturedRequest(url='https://x.com', method='GET', response_body='[]', response_status=200)
    assert r.url == 'https://x.com'
    assert r.response_body == '[]'


def test_captured_request_camel_alias():
    r = CapturedRequest.model_validate({
        'url': 'https://x.com',
        'method': 'GET',
        'responseBody': '[]',
        'responseStatus': 200,
    })
    assert r.response_body == '[]'
    assert r.response_status == 200


def test_captured_request_serialises_camel():
    r = CapturedRequest(url='https://x.com', method='GET', response_body='{}', response_status=200)
    d = r.model_dump(by_alias=True)
    assert 'responseBody' in d
    assert 'responseStatus' in d


def test_company_crawl_result_defaults():
    result = CompanyCrawlResult(search_id='s1', company_id='c1')
    assert result.network_capture == []
    assert result.needs_discovery is False


def test_company_crawl_result_with_capture():
    capture = [CapturedRequest(url='https://x.com/api', method='GET', response_body='[]', response_status=200)]
    result = CompanyCrawlResult(search_id='s1', company_id='c1', network_capture=capture, needs_discovery=True)
    assert len(result.network_capture) == 1
    assert result.needs_discovery is True
    d = result.model_dump(by_alias=True)
    assert 'networkCapture' in d
    assert 'needsDiscovery' in d
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd /home/cda/dev/job-search/crawler && python -m pytest tests/test_models.py -v 2>&1 | tail -10
```

Expected: `ImportError` or `ValidationError` because `CapturedRequest` doesn't exist yet.

- [ ] **Step 3: Add `CapturedRequest` and update `CompanyCrawlResult` in `models.py`**

In `crawler/models.py`, add after the `CrawlerConfig` class (around line 60):

```python
# ---------------------------------------------------------------------------
# CapturedRequest — one XHR/fetch call intercepted by Playwright
# ---------------------------------------------------------------------------

class CapturedRequest(BaseModel):
    """A JSON API call intercepted by the Playwright network interceptor."""

    model_config = _CAMEL_CONFIG

    url: str = Field(description="Full URL of the intercepted request")
    method: str = Field(description="HTTP method: GET or POST")
    response_body: str = Field(description="JSON response body truncated to 3KB")
    response_status: int = Field(description="HTTP response status code")
```

Then update `CompanyCrawlResult` (around line 248) to add two new fields after `errors`:

```python
    network_capture: list[CapturedRequest] = Field(
        default_factory=list,
        description="XHR/fetch calls captured by Playwright when Scrapy returns 0 items"
    )
    needs_discovery: bool = Field(
        default=False,
        description="True when Playwright captured candidates and API asks Claude to discover the endpoint"
    )
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd /home/cda/dev/job-search/crawler && python -m pytest tests/test_models.py -v
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add crawler/models.py crawler/tests/__init__.py crawler/tests/test_models.py
git commit -m "feat(crawler): add CapturedRequest model and network_capture fields to CompanyCrawlResult"
```

---

### Task 7: `_looks_like_job_list` function

**Files:**
- Create: `crawler/job_crawler/network_interceptor.py`
- Create: `crawler/tests/test_network_interceptor.py`

- [ ] **Step 1: Write failing tests**

Create `crawler/tests/test_network_interceptor.py`:

```python
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import pytest
from job_crawler.network_interceptor import _looks_like_job_list


def test_top_level_list_with_two_or_more_items():
    assert _looks_like_job_list([{'id': 1}, {'id': 2}]) is True


def test_top_level_list_with_one_item_is_false():
    assert _looks_like_job_list([{'id': 1}]) is False


def test_empty_list_is_false():
    assert _looks_like_job_list([]) is False


def test_dict_with_jobs_key():
    assert _looks_like_job_list({'jobs': [{'id': 1}, {'id': 2}]}) is True


def test_dict_with_postings_key():
    assert _looks_like_job_list({'postings': [{'id': 1}, {'id': 2}]}) is True


def test_dict_with_requisitions_key():
    assert _looks_like_job_list({'requisitions': [{'id': 1}, {'id': 2}]}) is True


def test_dict_with_known_key_but_only_one_item_is_false():
    assert _looks_like_job_list({'jobs': [{'id': 1}]}) is False


def test_dict_with_no_job_keys_is_false():
    assert _looks_like_job_list({'status': 'ok', 'version': 1}) is False


def test_non_dict_non_list_is_false():
    assert _looks_like_job_list('hello') is False
    assert _looks_like_job_list(42) is False
    assert _looks_like_job_list(None) is False
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd /home/cda/dev/job-search/crawler && python -m pytest tests/test_network_interceptor.py -v 2>&1 | tail -5
```

Expected: `ModuleNotFoundError: No module named 'job_crawler.network_interceptor'`

- [ ] **Step 3: Implement `_looks_like_job_list` in a new file**

Create `crawler/job_crawler/network_interceptor.py`:

```python
"""
Playwright-based network interceptor for SPA career pages.

When Scrapy returns 0 items from a career page, this module launches a
headless Chromium browser, navigates to the URL, and captures all JSON
XHR/fetch responses that look like job listing APIs.

The captured requests are returned to the API layer for one-time LLM
analysis to identify the endpoint pattern and field mapping.
"""

import asyncio
import json
import sys
import os

_crawler_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _crawler_root not in sys.path:
    sys.path.insert(0, _crawler_root)

from models import CapturedRequest
from logger import get_logger

log = get_logger(__name__)

MAX_BODY_BYTES = 3000
MAX_CANDIDATES = 5
_JOB_LIST_KEYS = frozenset(
    ('jobs', 'postings', 'positions', 'results', 'data', 'items', 'requisitions')
)


def _looks_like_job_list(body: object) -> bool:
    if isinstance(body, list):
        return len(body) >= 2
    if isinstance(body, dict):
        for key in _JOB_LIST_KEYS:
            val = body.get(key)
            if isinstance(val, list) and len(val) >= 2:
                return True
    return False


async def capture_job_api_calls(url: str) -> list[CapturedRequest]:
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        log.warning("playwright not installed; skipping network capture")
        return []

    captured: list[CapturedRequest] = []

    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()

        async def on_response(response):
            if len(captured) >= MAX_CANDIDATES:
                return
            if 'json' not in response.headers.get('content-type', ''):
                return
            try:
                body = await response.json()
            except Exception:
                return
            if not _looks_like_job_list(body):
                return
            captured.append(CapturedRequest(
                url=response.url,
                method=response.request.method,
                response_body=json.dumps(body)[:MAX_BODY_BYTES],
                response_status=response.status,
            ))

        page.on('response', on_response)

        try:
            await page.goto(url, wait_until='networkidle', timeout=30000)
        except Exception as exc:
            log.warning(
                "Playwright navigation failed",
                extra={"url": url, "error": str(exc)},
            )

        await browser.close()

    log.info(
        "Network capture complete",
        extra={"url": url, "candidates": len(captured)},
    )
    return captured
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd /home/cda/dev/job-search/crawler && python -m pytest tests/test_network_interceptor.py -v
```

Expected: all 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add crawler/job_crawler/network_interceptor.py crawler/tests/test_network_interceptor.py
git commit -m "feat(crawler): add NetworkInterceptor with Playwright-based SPA network capture"
```

---

### Task 8: CLI Playwright fallback in `_run_company_crawl_worker`

**Files:**
- Modify: `crawler/cli.py`

- [ ] **Step 1: Replace the result-building block at the end of `_run_company_crawl_worker`**

In `crawler/cli.py`, locate `_run_company_crawl_worker` (around line 150). The current block that puts the result on the queue is:

```python
    validated_jobs = []
    for raw_item in collected_jobs:
        job = scrapy_item_to_job_data(raw_item)
        if job is not None:
            validated_jobs.append(job)

    queue.put({
        "search_id": search_id,
        "company_id": company_id,
        "jobs": [j.model_dump(by_alias=True) for j in validated_jobs],
        "discovered_companies": [],
        "errors": [],
        "timestamp": SiteResult.utc_now_iso(),
    })
```

Replace it with:

```python
    validated_jobs = []
    for raw_item in collected_jobs:
        job = scrapy_item_to_job_data(raw_item)
        if job is not None:
            validated_jobs.append(job)

    if not validated_jobs:
        # Scrapy got nothing — try Playwright network capture for SPA detection
        from job_crawler.network_interceptor import capture_job_api_calls
        network_capture = asyncio.run(capture_job_api_calls(url))
        queue.put({
            "search_id": search_id,
            "company_id": company_id,
            "jobs": [],
            "network_capture": [r.model_dump(by_alias=True) for r in network_capture],
            "needs_discovery": len(network_capture) > 0,
            "discovered_companies": [],
            "errors": [],
            "timestamp": SiteResult.utc_now_iso(),
        })
    else:
        queue.put({
            "search_id": search_id,
            "company_id": company_id,
            "jobs": [j.model_dump(by_alias=True) for j in validated_jobs],
            "network_capture": [],
            "needs_discovery": False,
            "discovered_companies": [],
            "errors": [],
            "timestamp": SiteResult.utc_now_iso(),
        })
```

Also add `import asyncio` at the top of the file if not already present. (Check with `grep "^import asyncio" crawler/cli.py`.)

- [ ] **Step 2: Verify import is present**

```bash
grep "^import asyncio" /home/cda/dev/job-search/crawler/cli.py || echo "MISSING"
```

If missing, add `import asyncio` after the other stdlib imports at the top.

- [ ] **Step 3: Smoke-test the worker with no Playwright (it should fall back gracefully)**

```bash
cd /home/cda/dev/job-search/crawler && python -c "
import multiprocessing, sys
q = multiprocessing.Queue()
from cli import _run_company_crawl_worker
# Pass a URL that will produce 0 Scrapy results (no Playwright installed yet is fine — will return [])
p = multiprocessing.Process(target=_run_company_crawl_worker, args=(q, 'test-id', 'co-id', 'https://example.com', 'TestCo', 'engineer'))
p.start()
p.join(timeout=15)
if not q.empty():
    result = q.get_nowait()
    print('needs_discovery:', result.get('needs_discovery'))
    print('network_capture count:', len(result.get('network_capture', [])))
else:
    print('TIMEOUT or CRASH')
"
```

Expected: prints `needs_discovery: False` and `network_capture count: 0` (Playwright not yet installed, graceful fallback).

- [ ] **Step 4: Commit**

```bash
git add crawler/cli.py
git commit -m "feat(crawler): add Playwright fallback to _run_company_crawl_worker when Scrapy returns 0 items"
```

---

### Task 9: Install Playwright + update Dockerfile

**Files:**
- Modify: `crawler/requirements.txt`
- Modify: `crawler/Dockerfile`

- [ ] **Step 1: Add dependencies to requirements.txt**

In `crawler/requirements.txt`, add:

```
# Browser automation for SPA career page rendering
playwright==1.52.0

# Testing
pytest==8.3.5
pytest-asyncio==0.24.0
```

- [ ] **Step 2: Install**

```bash
cd /home/cda/dev/job-search/crawler && pip install playwright==1.52.0 pytest==8.3.5 pytest-asyncio==0.24.0 && playwright install chromium
```

Expected: Chromium downloads and installs (may take 30–60 seconds).

- [ ] **Step 3: Update Dockerfile**

In `crawler/Dockerfile`, read its current content first, then add after the `pip install` line:

```dockerfile
RUN playwright install chromium --with-deps
```

The `--with-deps` flag installs system libraries Chromium needs (fonts, libnss, etc.) which are absent in minimal Docker images.

- [ ] **Step 4: Run all crawler tests**

```bash
cd /home/cda/dev/job-search/crawler && python -m pytest tests/ -v
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add crawler/requirements.txt crawler/Dockerfile
git commit -m "feat(crawler): add Playwright and pytest dependencies"
```

---

### Task 10: `crawl_company` handler update

**Files:**
- Modify: `packages/api/src/events/handlers.ts`
- Create: `packages/api/src/events/__tests__/crawl-company-handler.test.ts`

- [ ] **Step 1: Write failing handler tests**

Create `packages/api/src/events/__tests__/crawl-company-handler.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock all external dependencies before importing the handler
vi.mock('../../db/models.js', () => ({
  SearchSessionModel: { findById: vi.fn() },
  CompanyModel: { findById: vi.fn(), findByIdAndUpdate: vi.fn() },
}))
vi.mock('../../events/queue.js', () => ({ addEvent: vi.fn() }))
vi.mock('axios', () => ({ default: { post: vi.fn() } }))
vi.mock('../../discovery/api-discoverer.js', () => ({ discoverJobsApi: vi.fn() }))
vi.mock('../../discovery/direct-fetcher.js', () => ({ fetchFromDiscoveredApi: vi.fn() }))

import { eventHandlers } from '../handlers.js'
import { SearchSessionModel, CompanyModel } from '../../db/models.js'
import { addEvent } from '../../events/queue.js'
import axios from 'axios'
import { discoverJobsApi } from '../../discovery/api-discoverer.js'
import { fetchFromDiscoveredApi } from '../../discovery/direct-fetcher.js'

const MOCK_SESSION = { _id: 'sess1', userId: 'user1', query: 'engineer' }
const MOCK_COMPANY_NO_API = { _id: 'co1', name: 'IBM', url: 'https://ibm.com/careers', discoveredApi: undefined }
const MOCK_COMPANY_WITH_API = {
  _id: 'co1',
  name: 'IBM',
  url: 'https://ibm.com/careers',
  discoveredApi: {
    endpoint: 'https://ibm.wd3.myworkdayjobs.com/api/jobs',
    method: 'GET',
    paramTemplate: { q: '{keywords}' },
    fieldMapping: { title: 'title', url: 'url', location: 'city', description: 'summary' },
    discoveredAt: new Date(),
  },
}
const MOCK_SSE = { broadcast: vi.fn() } as any
const HANDLER_DATA = { searchId: 'sess1', companyId: 'co1', url: 'https://ibm.com/careers', companyName: 'IBM', query: 'engineer' }

beforeEach(() => vi.clearAllMocks())

describe('crawl_company handler', () => {
  describe('fast path: company has discoveredApi and returns jobs', () => {
    it('calls fetchFromDiscoveredApi and emits company_crawled without calling crawler', async () => {
      vi.mocked(SearchSessionModel.findById).mockResolvedValue(MOCK_SESSION as any)
      vi.mocked(CompanyModel.findById).mockResolvedValue(MOCK_COMPANY_WITH_API as any)
      vi.mocked(fetchFromDiscoveredApi).mockResolvedValue([
        { title: 'Software Engineer', company: 'IBM', location: 'Berlin', url: 'https://ibm.com/jobs/1', description: 'Great role with many responsibilities', sourceUrl: 'https://ibm.com/careers' },
      ])

      await eventHandlers.crawl_company(HANDLER_DATA, MOCK_SSE)

      expect(axios.post).not.toHaveBeenCalled()
      expect(addEvent).toHaveBeenCalledWith('company_crawled', expect.objectContaining({
        searchId: 'sess1',
        companyId: 'co1',
        jobs: expect.arrayContaining([expect.objectContaining({ title: 'Software Engineer' })]),
      }))
    })
  })

  describe('re-discovery path: discoveredApi exists but returns 0 jobs', () => {
    it('clears discoveredApi and falls through to crawler', async () => {
      vi.mocked(SearchSessionModel.findById).mockResolvedValue(MOCK_SESSION as any)
      vi.mocked(CompanyModel.findById).mockResolvedValue(MOCK_COMPANY_WITH_API as any)
      vi.mocked(fetchFromDiscoveredApi).mockResolvedValue([])
      vi.mocked(axios.post).mockResolvedValue({ data: { jobs: [], needsDiscovery: false, networkCapture: [] } })

      await eventHandlers.crawl_company(HANDLER_DATA, MOCK_SSE)

      expect(CompanyModel.findByIdAndUpdate).toHaveBeenCalledWith('co1', { $unset: { discoveredApi: 1 } })
      expect(axios.post).toHaveBeenCalled()
    })
  })

  describe('discovery path: Scrapy returned 0 jobs and Playwright captured traffic', () => {
    it('calls discoverJobsApi, stores config, fetches jobs, emits company_crawled', async () => {
      vi.mocked(SearchSessionModel.findById).mockResolvedValue(MOCK_SESSION as any)
      vi.mocked(CompanyModel.findById).mockResolvedValue(MOCK_COMPANY_NO_API as any)
      vi.mocked(axios.post).mockResolvedValue({
        data: {
          jobs: [],
          needsDiscovery: true,
          networkCapture: [{ url: 'https://ibm.wd3.myworkdayjobs.com/api/jobs', method: 'GET', responseBody: '{"jobs":[]}', responseStatus: 200 }],
        },
      })
      const config = {
        endpoint: 'https://ibm.wd3.myworkdayjobs.com/api/jobs',
        method: 'GET' as const,
        paramTemplate: { q: '{keywords}' },
        fieldMapping: { title: 'title', url: 'url', location: 'city', description: 'summary' },
        discoveredAt: new Date(),
      }
      vi.mocked(discoverJobsApi).mockResolvedValue(config)
      vi.mocked(fetchFromDiscoveredApi).mockResolvedValue([
        { title: 'Software Engineer', company: 'IBM', location: 'Berlin', url: 'https://ibm.com/jobs/1', description: 'Great role', sourceUrl: 'https://ibm.com/careers' },
      ])

      await eventHandlers.crawl_company(HANDLER_DATA, MOCK_SSE)

      expect(discoverJobsApi).toHaveBeenCalledWith('user1', 'IBM', 'https://ibm.com/careers', expect.any(Array))
      expect(CompanyModel.findByIdAndUpdate).toHaveBeenCalledWith('co1', { discoveredApi: config })
      expect(addEvent).toHaveBeenCalledWith('company_crawled', expect.objectContaining({ jobs: expect.any(Array) }))
    })
  })

  describe('standard path: Scrapy found jobs', () => {
    it('emits company_crawled with Scrapy jobs directly', async () => {
      vi.mocked(SearchSessionModel.findById).mockResolvedValue(MOCK_SESSION as any)
      vi.mocked(CompanyModel.findById).mockResolvedValue(MOCK_COMPANY_NO_API as any)
      vi.mocked(axios.post).mockResolvedValue({
        data: { jobs: [{ title: 'Engineer', company: 'IBM' }], needsDiscovery: false, networkCapture: [] },
      })

      await eventHandlers.crawl_company(HANDLER_DATA, MOCK_SSE)

      expect(discoverJobsApi).not.toHaveBeenCalled()
      expect(addEvent).toHaveBeenCalledWith('company_crawled', expect.objectContaining({
        jobs: [{ title: 'Engineer', company: 'IBM' }],
      }))
    })
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd packages/api && npm test -- --run --reporter=verbose 2>&1 | grep -E "(PASS|FAIL|✓|✗|crawl-company-handler)"
```

Expected: tests fail because `crawl_company` handler doesn't import discovery modules yet.

- [ ] **Step 3: Update the `crawl_company` handler in `handlers.ts`**

At the top of `packages/api/src/events/handlers.ts`, add these two imports after the existing imports:

```typescript
import { discoverJobsApi } from '../discovery/api-discoverer.js'
import { fetchFromDiscoveredApi } from '../discovery/direct-fetcher.js'
```

Then replace the entire `crawl_company` handler (lines 278–312) with:

```typescript
  crawl_company: async (
    data: { searchId: string; companyId: string; url: string; companyName: string; query: string },
    sseManager: SSEManager
  ) => {
    try {
      console.log(`\n🤖 AGENT LOG - Crawl Company`)
      console.log(`   Crawling ${data.companyName} at ${data.url}`)

      const session = await SearchSessionModel.findById(data.searchId)
      if (!session) {
        console.warn('Session not found:', data.searchId)
        return
      }

      const company = await CompanyModel.findById(data.companyId)

      // Fast path: use previously discovered API endpoint
      if (company?.discoveredApi) {
        try {
          const jobs = await fetchFromDiscoveredApi(
            company.discoveredApi,
            data.query,
            data.companyName,
            data.url
          )
          if (jobs.length > 0) {
            console.log(`   ✅ DirectFetcher: ${jobs.length} jobs from cached endpoint`)
            await addEvent('company_crawled', {
              searchId: data.searchId,
              companyId: data.companyId,
              jobs,
              discoveredCompanies: [],
            })
            return
          }
          // 0 jobs from known endpoint — API may have changed; clear and re-discover
          console.log(`   ⚠️  DirectFetcher returned 0 jobs for ${data.companyName}; clearing discoveredApi`)
          await CompanyModel.findByIdAndUpdate(data.companyId, { $unset: { discoveredApi: 1 } })
        } catch (err: any) {
          console.warn(`   ⚠️  DirectFetcher failed for ${data.companyName}: ${err.message}; clearing discoveredApi`)
          await CompanyModel.findByIdAndUpdate(data.companyId, { $unset: { discoveredApi: 1 } })
        }
      }

      // Normal crawler path
      const crawlerUrl = process.env.CRAWLER_SERVICE_URL || 'http://localhost:5000'
      const response = await axios.post(
        `${crawlerUrl}/crawler/crawl-company`,
        {
          searchId: data.searchId,
          companyId: data.companyId,
          url: data.url,
          companyName: data.companyName,
          query: data.query,
        },
        { timeout: 90000 }
      )

      const result = response.data
      console.log(`   ✅ Crawled ${data.companyName}: ${result.jobs?.length || 0} jobs found`)

      // Discovery path: Scrapy got 0 but Playwright captured API traffic
      if (result.needsDiscovery && result.networkCapture?.length > 0) {
        const config = await discoverJobsApi(
          session.userId,
          data.companyName,
          data.url,
          result.networkCapture
        )
        if (config) {
          await CompanyModel.findByIdAndUpdate(data.companyId, { discoveredApi: config })
          console.log(`   🔍 Discovered API for ${data.companyName} (${config.platform || 'custom'})`)
          try {
            const jobs = await fetchFromDiscoveredApi(config, data.query, data.companyName, data.url)
            console.log(`   ✅ DirectFetcher post-discovery: ${jobs.length} jobs`)
            await addEvent('company_crawled', {
              searchId: data.searchId,
              companyId: data.companyId,
              jobs,
              discoveredCompanies: [],
            })
            return
          } catch (err: any) {
            console.warn(`   ⚠️  DirectFetcher failed after discovery: ${err.message}`)
          }
        }
      }

      // Standard Scrapy result (or discovery failed — return whatever Scrapy found)
      await addEvent('company_crawled', {
        searchId: data.searchId,
        companyId: data.companyId,
        jobs: result.jobs || [],
        discoveredCompanies: result.discoveredCompanies || [],
      })
    } catch (error: any) {
      console.error(`Error crawling company ${data.companyName}:`, error.message)
      const company = await CompanyModel.findById(data.companyId)
      if (company) {
        company.status = 'failed'
        await company.save()
      }
    }
  },
```

- [ ] **Step 4: Run all API tests**

```bash
cd packages/api && npm test -- --run --reporter=verbose 2>&1 | tail -20
```

Expected: all tests pass including the new `crawl-company-handler` suite.

- [ ] **Step 5: TypeScript build check**

```bash
npm run build --workspace=@job-search/api
```

Expected: exits 0, no type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/events/handlers.ts packages/api/src/events/__tests__/crawl-company-handler.test.ts
git commit -m "feat(api): update crawl_company handler with fast path, discovery path, and re-discovery"
```

---

### Task 11: Full test suite and build verification

**Files:** none new

- [ ] **Step 1: Run all crawler Python tests**

```bash
cd /home/cda/dev/job-search/crawler && python -m pytest tests/ -v
```

Expected: all tests pass.

- [ ] **Step 2: Run all API tests**

```bash
cd /home/cda/dev/job-search/packages/api && npm test -- --run
```

Expected: all 62+ tests pass (some new ones added).

- [ ] **Step 3: Full CI simulation**

```bash
cd /home/cda/dev/job-search
npm ci
npm run build --workspace=@job-search/shared
npm test -- --run --workspace=@job-search/api
npm run build --workspace=@job-search/api
npm run build --workspace=@job-search/frontend
```

Expected: all steps exit 0.

- [ ] **Step 4: Final commit if any fixups needed**

```bash
git add -p   # review any remaining changes
git commit -m "chore: final fixups for SPA API discovery feature"
```
