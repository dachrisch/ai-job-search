# Arbeitsagentur Source Slice — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a query-based `SourceManager` with a first Tier-1 source (`ArbeitsagenturSource`) and wire it into `search_started` so real DACH jobs flow through the existing Claude-scoring / SSE / frontend pipeline.

**Architecture:** Introduce a query-centric `JobSource` interface (`search(query) → jobs`) replacing the crawl-centric model. `SourceManager` fans out to sources in parallel, merges, and dedupes by normalized URL. The `search_started` handler runs the manager *additively* (alongside the existing company-discovery path), stores returned jobs, and emits the existing `jobs_extracted` event — so nothing downstream changes.

**Tech Stack:** TypeScript (Node 20), Express, Mongoose, BullMQ, Anthropic SDK, Vitest, axios. The Arbeitsagentur "Jobsuche" REST API (public, free, `X-API-Key: jobboerse-jobsuche`).

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `packages/api/src/sources/types.ts` | `JobQuery`, `SourceJob`, `SourceResult`, `JobSource` interfaces | Create |
| `packages/api/src/sources/arbeitsagentur-source.ts` | Tier-1 source: query → Arbeitsagentur API → `SourceJob[]` | Create |
| `packages/api/src/sources/manager.ts` | `SourceManager`: parallel fan-out + merge + URL dedup + failure isolation | Create |
| `packages/api/src/sources/__tests__/arbeitsagentur-source.test.ts` | Unit tests (mocked axios + fixtures) | Create |
| `packages/api/src/sources/__tests__/arbeitsagentur-source.fixtures.ts` | Recorded API JSON fixtures | Create |
| `packages/api/src/sources/__tests__/manager.test.ts` | Unit tests for fan-out/merge/dedup/isolation | Create |
| `packages/api/src/sources/__tests__/arbeitsagentur-source.integration.test.ts` | Opt-in live API contract test | Create |
| `packages/shared/src/types.ts` | Widen `Job.discoveryMethod` union | Modify (`:24`) |
| `packages/api/src/db/models.ts` | Widen `discoveryMethod` schema enum | Modify (`:26`) |
| `packages/api/src/events/handlers.ts` | Wire `SourceManager` into `search_started` | Modify (`:17-73`) |

> Note: the new code lives in a fresh `packages/api/src/sources/` directory, intentionally separate from the legacy crawl-centric `packages/api/src/job-sources/` (which the spec marks for phased retirement). Do **not** import from `job-sources/` here.

---

### Task 1: Source interfaces

**Files:**
- Create: `packages/api/src/sources/types.ts`

- [ ] **Step 1: Create the interfaces file**

```typescript
// packages/api/src/sources/types.ts

/** A normalized, structured job search query handed to every source. */
export interface JobQuery {
  keywords: string
  location?: string
  radius?: number // km
  remote?: boolean
  raw: string // the original user query, unmodified
}

/** A job as returned by a source — lean, pre-persistence shape. */
export interface SourceJob {
  title: string
  company: string
  description: string
  url: string
  location: string
  salary?: string
  sourceUrl: string // identifier of the producing source, e.g. "arbeitsagentur"
}

/** The result of querying a single source. Failures are returned, not thrown. */
export interface SourceResult {
  source: string
  jobs: SourceJob[]
  errors: Array<{ message: string }>
}

/** A job source. Query in, jobs out. No DB or event-queue knowledge. */
export interface JobSource {
  name: string
  tier: 1 | 2 | 3 // 1 = API, 2 = search+LLM, 3 = ATS adapter
  search(query: JobQuery): Promise<SourceResult>
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build --workspace=@job-search/api`
Expected: builds with no new errors (the file is types-only and unused so far).

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/sources/types.ts
git commit -m "feat(sources): add query-based JobSource interfaces"
```

---

### Task 2: Arbeitsagentur fixtures

**Files:**
- Create: `packages/api/src/sources/__tests__/arbeitsagentur-source.fixtures.ts`

- [ ] **Step 1: Create the fixtures file**

These mirror the shape of the Arbeitsagentur `pc/v4/jobs` response. The `stellenangebote`
array holds postings; `maxErgebnisse` is the total count.

```typescript
// packages/api/src/sources/__tests__/arbeitsagentur-source.fixtures.ts

/** Two well-formed postings. */
export const twoJobsResponse = {
  maxErgebnisse: 2,
  stellenangebote: [
    {
      refnr: '10000-1198765432-S',
      titel: 'Senior Python Entwickler (m/w/d)',
      beruf: 'Softwareentwickler/in',
      arbeitgeber: 'ACME GmbH',
      arbeitsort: { ort: 'Berlin', region: 'Berlin', plz: '10115' },
    },
    {
      refnr: '10000-1199999999-S',
      titel: 'Backend Engineer Node.js',
      beruf: 'Softwareentwickler/in',
      arbeitgeber: 'Beispiel AG',
      arbeitsort: { ort: 'München', region: 'Bayern', plz: '80331' },
    },
  ],
}

/** Empty result set. */
export const emptyResponse = {
  maxErgebnisse: 0,
  stellenangebote: [],
}

/** A posting missing optional/expected fields (no employer, no arbeitsort). */
export const partialJobResponse = {
  maxErgebnisse: 1,
  stellenangebote: [
    {
      refnr: '10000-1100000000-S',
      titel: 'Werkstudent Softwareentwicklung',
      // arbeitgeber missing
      // arbeitsort missing
    },
  ],
}

/** Malformed payload — `stellenangebote` is not an array. */
export const malformedResponse = {
  maxErgebnisse: 'oops',
  stellenangebote: null,
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/api/src/sources/__tests__/arbeitsagentur-source.fixtures.ts
git commit -m "test(sources): add Arbeitsagentur API response fixtures"
```

---

### Task 3: ArbeitsagenturSource — happy path

**Files:**
- Create: `packages/api/src/sources/arbeitsagentur-source.ts`
- Test: `packages/api/src/sources/__tests__/arbeitsagentur-source.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/api/src/sources/__tests__/arbeitsagentur-source.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import axios from 'axios'
import { ArbeitsagenturSource } from '../arbeitsagentur-source'
import { twoJobsResponse } from './arbeitsagentur-source.fixtures'

vi.mock('axios')

describe('ArbeitsagenturSource', () => {
  const source = new ArbeitsagenturSource()

  beforeEach(() => {
    vi.mocked(axios.get).mockReset()
  })

  it('queries the API with was= and maps postings to SourceJobs', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: twoJobsResponse })

    const result = await source.search({ keywords: 'python entwickler', raw: 'python entwickler' })

    // Called the jobs endpoint with the keyword and the public API key header
    const [calledUrl, calledConfig] = vi.mocked(axios.get).mock.calls[0]
    expect(calledUrl).toContain('/jobsuche-service/pc/v4/jobs')
    expect(calledConfig?.params?.was).toBe('python entwickler')
    expect(calledConfig?.headers?.['X-API-Key']).toBe('jobboerse-jobsuche')

    // Mapped two jobs correctly
    expect(result.source).toBe('arbeitsagentur')
    expect(result.errors).toEqual([])
    expect(result.jobs).toHaveLength(2)

    const first = result.jobs[0]
    expect(first.title).toBe('Senior Python Entwickler (m/w/d)')
    expect(first.company).toBe('ACME GmbH')
    expect(first.location).toBe('Berlin')
    expect(first.sourceUrl).toBe('arbeitsagentur')
    expect(first.url).toContain('10000-1198765432-S')
    expect(first.description.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/api && npm test -- --run src/sources/__tests__/arbeitsagentur-source.test.ts`
Expected: FAIL — `Cannot find module '../arbeitsagentur-source'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/api/src/sources/arbeitsagentur-source.ts
import axios from 'axios'
import { JobQuery, JobSource, SourceJob, SourceResult } from './types.js'

const API_URL = 'https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc/v4/jobs'
const API_KEY = 'jobboerse-jobsuche' // public, well-known client key
const DETAIL_BASE = 'https://www.arbeitsagentur.de/jobsuche/jobdetail/'
const DEFAULT_SIZE = 25
const TIMEOUT_MS = 5000

interface Posting {
  refnr?: string
  titel?: string
  beruf?: string
  arbeitgeber?: string
  arbeitsort?: { ort?: string; region?: string; plz?: string }
}

export class ArbeitsagenturSource implements JobSource {
  name = 'arbeitsagentur'
  tier = 1 as const

  async search(query: JobQuery): Promise<SourceResult> {
    const response = await axios.get(API_URL, {
      params: {
        was: query.keywords,
        ...(query.location ? { wo: query.location } : {}),
        ...(query.radius ? { umkreis: query.radius } : {}),
        size: DEFAULT_SIZE,
      },
      headers: { 'X-API-Key': API_KEY },
      timeout: TIMEOUT_MS,
    })

    const postings: Posting[] = Array.isArray(response.data?.stellenangebote)
      ? response.data.stellenangebote
      : []

    const jobs = postings
      .map((p) => this.toSourceJob(p))
      .filter((j): j is SourceJob => j !== null)

    return { source: this.name, jobs, errors: [] }
  }

  private toSourceJob(p: Posting): SourceJob | null {
    if (!p.refnr || !p.titel) return null

    const company = p.arbeitgeber ?? 'Unbekannt'
    const location = p.arbeitsort?.ort ?? 'Deutschland'
    const url = DETAIL_BASE + encodeURIComponent(p.refnr)

    return {
      title: p.titel,
      company,
      // The list endpoint has no full description; synthesize a non-empty one to
      // satisfy the required Job.description field. Enrichment via the job-detail
      // endpoint is a Tier-1 follow-up.
      description: `${p.titel} bei ${company} in ${location}.`,
      url,
      location,
      sourceUrl: this.name,
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/api && npm test -- --run src/sources/__tests__/arbeitsagentur-source.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/sources/arbeitsagentur-source.ts packages/api/src/sources/__tests__/arbeitsagentur-source.test.ts
git commit -m "feat(sources): add ArbeitsagenturSource happy-path mapping"
```

---

### Task 4: ArbeitsagenturSource — empty, partial, malformed inputs

**Files:**
- Test: `packages/api/src/sources/__tests__/arbeitsagentur-source.test.ts` (add cases)

- [ ] **Step 1: Add the failing tests**

Append inside the existing `describe('ArbeitsagenturSource', …)` block:

```typescript
  it('returns no jobs and no errors for an empty result set', async () => {
    const { emptyResponse } = await import('./arbeitsagentur-source.fixtures')
    vi.mocked(axios.get).mockResolvedValue({ data: emptyResponse })

    const result = await source.search({ keywords: 'cobol entwickler', raw: 'cobol entwickler' })

    expect(result.jobs).toEqual([])
    expect(result.errors).toEqual([])
  })

  it('fills sensible defaults when a posting is missing employer/location', async () => {
    const { partialJobResponse } = await import('./arbeitsagentur-source.fixtures')
    vi.mocked(axios.get).mockResolvedValue({ data: partialJobResponse })

    const result = await source.search({ keywords: 'werkstudent', raw: 'werkstudent' })

    expect(result.jobs).toHaveLength(1)
    expect(result.jobs[0].company).toBe('Unbekannt')
    expect(result.jobs[0].location).toBe('Deutschland')
  })

  it('treats a malformed payload as zero jobs (no throw)', async () => {
    const { malformedResponse } = await import('./arbeitsagentur-source.fixtures')
    vi.mocked(axios.get).mockResolvedValue({ data: malformedResponse })

    const result = await source.search({ keywords: 'python', raw: 'python' })

    expect(result.jobs).toEqual([])
    expect(result.errors).toEqual([])
  })
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd packages/api && npm test -- --run src/sources/__tests__/arbeitsagentur-source.test.ts`
Expected: PASS for all four tests (the Task 3 implementation already handles these — the
guards `Array.isArray(...)`, `?? 'Unbekannt'`, `?? 'Deutschland'`, and the `refnr/titel`
filter cover them).

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/sources/__tests__/arbeitsagentur-source.test.ts
git commit -m "test(sources): cover empty/partial/malformed Arbeitsagentur payloads"
```

---

### Task 5: SourceManager — fan-out, merge, dedup, isolation

**Files:**
- Create: `packages/api/src/sources/manager.ts`
- Test: `packages/api/src/sources/__tests__/manager.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/api/src/sources/__tests__/manager.test.ts
import { describe, it, expect } from 'vitest'
import { SourceManager } from '../manager'
import { JobSource, JobQuery, SourceResult, SourceJob } from '../types'

function job(url: string, title = 'Dev'): SourceJob {
  return { title, company: 'C', description: 'd', url, location: 'Berlin', sourceUrl: 's' }
}

class StubSource implements JobSource {
  tier = 1 as const
  constructor(public name: string, private result: SourceResult | Error) {}
  async search(_q: JobQuery): Promise<SourceResult> {
    if (this.result instanceof Error) throw this.result
    return this.result
  }
}

const query: JobQuery = { keywords: 'dev', raw: 'dev' }

describe('SourceManager', () => {
  it('merges jobs from all sources', async () => {
    const a = new StubSource('a', { source: 'a', jobs: [job('https://x.de/1')], errors: [] })
    const b = new StubSource('b', { source: 'b', jobs: [job('https://x.de/2')], errors: [] })
    const mgr = new SourceManager([a, b])

    const result = await mgr.search(query)

    expect(result.jobs).toHaveLength(2)
  })

  it('dedupes by normalized URL (case + trailing slash insensitive)', async () => {
    const a = new StubSource('a', { source: 'a', jobs: [job('https://X.de/JobA/')], errors: [] })
    const b = new StubSource('b', { source: 'b', jobs: [job('https://x.de/joba')], errors: [] })
    const mgr = new SourceManager([a, b])

    const result = await mgr.search(query)

    expect(result.jobs).toHaveLength(1)
  })

  it('isolates a failing source: others still return, failure recorded', async () => {
    const a = new StubSource('a', new Error('boom'))
    const b = new StubSource('b', { source: 'b', jobs: [job('https://x.de/2')], errors: [] })
    const mgr = new SourceManager([a, b])

    const result = await mgr.search(query)

    expect(result.jobs).toHaveLength(1)
    expect(result.errors.some((e) => e.message.includes('boom'))).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/api && npm test -- --run src/sources/__tests__/manager.test.ts`
Expected: FAIL — `Cannot find module '../manager'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/api/src/sources/manager.ts
import { JobQuery, JobSource, SourceJob, SourceResult } from './types.js'

function normalizeUrl(url: string): string {
  return url.trim().toLowerCase().replace(/\/+$/, '')
}

export class SourceManager {
  constructor(private sources: JobSource[]) {}

  async search(query: JobQuery): Promise<SourceResult> {
    const settled = await Promise.all(
      this.sources.map(async (source): Promise<SourceResult> => {
        try {
          return await source.search(query)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return { source: source.name, jobs: [], errors: [{ message: `${source.name}: ${message}` }] }
        }
      })
    )

    const seen = new Set<string>()
    const jobs: SourceJob[] = []
    const errors: SourceResult['errors'] = []

    for (const result of settled) {
      errors.push(...result.errors)
      for (const job of result.jobs) {
        const key = normalizeUrl(job.url)
        if (seen.has(key)) continue
        seen.add(key)
        jobs.push(job)
      }
    }

    return { source: 'source-manager', jobs, errors }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/api && npm test -- --run src/sources/__tests__/manager.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/sources/manager.ts packages/api/src/sources/__tests__/manager.test.ts
git commit -m "feat(sources): add SourceManager fan-out with URL dedup and failure isolation"
```

---

### Task 6: Widen `discoveryMethod` to allow `'arbeitsagentur'`

**Files:**
- Modify: `packages/shared/src/types.ts:24`
- Modify: `packages/api/src/db/models.ts:26`

- [ ] **Step 1: Widen the shared type**

In `packages/shared/src/types.ts`, change the `Job.discoveryMethod` field:

```typescript
  discoveryMethod: 'company_page' | 'arbeitsagentur'
```

- [ ] **Step 2: Widen the Mongoose enum**

In `packages/api/src/db/models.ts`, change the `discoveryMethod` schema definition:

```typescript
  discoveryMethod: { type: String, enum: ['company_page', 'arbeitsagentur'], required: true, default: 'company_page' },
```

- [ ] **Step 3: Rebuild shared, then typecheck api**

Run: `npm run build --workspace=@job-search/shared && npm run build --workspace=@job-search/api`
Expected: both build with no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/types.ts packages/api/src/db/models.ts
git commit -m "feat(models): allow 'arbeitsagentur' as a job discoveryMethod"
```

---

### Task 7: Wire SourceManager into `search_started` (additive, fail-soft)

**Files:**
- Modify: `packages/api/src/events/handlers.ts:17-73`

- [ ] **Step 1: Add the import**

At the top of `packages/api/src/events/handlers.ts`, alongside the other imports, add:

```typescript
import { SourceManager } from '../sources/manager.js'
import { ArbeitsagenturSource } from '../sources/arbeitsagentur-source.js'
```

- [ ] **Step 2: Run Tier-1 sources before company discovery**

In the `search_started` handler, immediately AFTER the Claude-token check block (the
`if (!user || !user.claudeApiToken) { … return }`, ending at `:37`) and BEFORE the
`// Use SearchSourceManager to discover companies` comment, insert:

```typescript
      // Tier-1 sources: query-native job APIs. Additive — runs alongside the existing
      // company-discovery path. Stores jobs and joins the existing scoring pipeline.
      const sourceManager = new SourceManager([new ArbeitsagenturSource()])
      const sourceResult = await sourceManager.search({ keywords: data.query, raw: data.query })
      if (sourceResult.errors.length > 0) {
        console.warn(`   ⚠️  Source errors: ${sourceResult.errors.map(e => e.message).join('; ')}`)
      }

      let apiJobsStored = 0
      for (const job of sourceResult.jobs) {
        const exists = await JobModel.findOne({ searchSessionId: data.searchId, url: job.url })
        if (exists) continue
        await JobModel.create({
          ...job,
          searchSessionId: data.searchId,
          discoveryMethod: 'arbeitsagentur',
          discoveredAt: new Date(),
          extractedAt: new Date(),
        })
        apiJobsStored++
      }

      if (apiJobsStored > 0) {
        session.jobsExtracted += apiJobsStored
        await session.save()
        const storedApiJobs = await JobModel.find({
          searchSessionId: data.searchId,
          discoveryMethod: 'arbeitsagentur',
        })
        await addEvent('jobs_extracted', {
          searchId: data.searchId,
          jobIds: storedApiJobs.map(j => j._id.toString()),
        })
      }
      console.log(`   ✅ Tier-1 sources stored ${apiJobsStored} jobs`)
```

- [ ] **Step 3: Make the "no companies" branch fail-soft**

Replace the existing no-companies block (currently `:46-53`):

```typescript
      if (companies.length === 0) {
        console.log(`   📋 No companies discovered, search failed`)
        await addEvent('search_failed', {
          searchId: data.searchId,
          error: 'No company career pages found'
        })
        return
      }
```

with:

```typescript
      if (companies.length === 0) {
        if (apiJobsStored > 0) {
          console.log(`   📋 No companies discovered, but ${apiJobsStored} API jobs found — search continues`)
          return
        }
        console.log(`   📋 No companies discovered and no API jobs, search failed`)
        await addEvent('search_failed', {
          searchId: data.searchId,
          error: 'No jobs found'
        })
        return
      }
```

- [ ] **Step 4: Typecheck the api package**

Run: `npm run build --workspace=@job-search/api`
Expected: builds with no errors.

- [ ] **Step 5: Run the full api unit suite to confirm no regressions**

Run: `cd packages/api && npm test -- --run`
Expected: PASS — existing tests green, plus the new source tests.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/events/handlers.ts
git commit -m "feat(search): run Tier-1 sources in search_started, fail-soft on no companies"
```

---

### Task 8: Opt-in live API contract test

**Files:**
- Create: `packages/api/src/sources/__tests__/arbeitsagentur-source.integration.test.ts`

- [ ] **Step 1: Write the opt-in integration test**

This test hits the real Arbeitsagentur API to catch contract drift. It is skipped unless
`RUN_INTEGRATION_TESTS=true`, matching the project's existing integration-test gating.

```typescript
// packages/api/src/sources/__tests__/arbeitsagentur-source.integration.test.ts
import { describe, it, expect } from 'vitest'
import { ArbeitsagenturSource } from '../arbeitsagentur-source'

const run = process.env.RUN_INTEGRATION_TESTS === 'true'

describe.skipIf(!run)('ArbeitsagenturSource (live)', () => {
  it('returns real jobs for a common DACH software query', async () => {
    const source = new ArbeitsagenturSource()

    const result = await source.search({
      keywords: 'softwareentwickler',
      location: 'Berlin',
      radius: 50,
      raw: 'softwareentwickler berlin',
    })

    expect(result.errors).toEqual([])
    expect(result.jobs.length).toBeGreaterThan(0)
    const j = result.jobs[0]
    expect(j.title).toBeTruthy()
    expect(j.company).toBeTruthy()
    expect(j.url).toContain('arbeitsagentur.de')
  }, 15000)
})
```

- [ ] **Step 2: Verify it is skipped by default**

Run: `cd packages/api && npm test -- --run src/sources/__tests__/arbeitsagentur-source.integration.test.ts`
Expected: the suite is skipped (0 tests run, no failures).

- [ ] **Step 3: Verify it passes live (optional, network required)**

Run: `cd packages/api && RUN_INTEGRATION_TESTS=true npm test -- --run src/sources/__tests__/arbeitsagentur-source.integration.test.ts`
Expected: PASS. If it FAILS, the API contract has drifted — reconcile the field mapping in
`arbeitsagentur-source.ts` (`toSourceJob`) and the params in `search()` against the live
response before proceeding.

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/sources/__tests__/arbeitsagentur-source.integration.test.ts
git commit -m "test(sources): add opt-in live Arbeitsagentur contract test"
```

---

## Manual verification (end-to-end)

After Task 8, verify the slice delivers jobs through the real pipeline:

1. Start the stack: `./scripts/dev-startup.sh`
2. Register/login, set a Claude API token (required for scoring in `jobs_extracted`).
3. Create a search with a DACH software query, e.g. `"Python Entwickler Berlin"`.
4. Confirm in MongoDB that `Job` documents with `discoveryMethod: 'arbeitsagentur'` exist
   for the session, and that they receive a `matchScore` after scoring.
5. Confirm the frontend results list populates (via SSE) with those jobs.

---

## Self-Review Notes

- **Spec coverage:** query-based `JobSource` interface (Task 1) ✓; `ArbeitsagenturSource`
  field mapping (Tasks 3–4) ✓; `SourceManager` fan-out + URL dedup + fail-soft isolation
  (Task 5) ✓; additive `search_started` wiring that joins the existing `jobs_extracted`
  pipeline (Task 7) ✓; reuse 0.4-gate decision — *not* applied to API jobs (Task 7 stores
  all) ✓; dedup at store time by URL (Task 7 `findOne` guard) ✓; `jobsExtracted` counter
  increment (Task 7) ✓; fail-soft error model (Task 5 + Task 7 fail-soft branch) ✓;
  fixtures + unit tests + opt-in live test (Tasks 2, 3, 4, 8) ✓.
- **Out of scope (correctly deferred):** Adzuna, Tier-2 LLM-extractor, Tier-3 adapter
  rehoming, and retirement of Pipeline B / brittle scrapers — each its own future plan.
- **Type consistency:** `JobSource.search → SourceResult` used identically across Tasks
  1, 3, 5; `SourceJob` fields match the `JobModel.create({...job})` spread in Task 7
  (title, company, description, url, location, salary?, sourceUrl); `discoveryMethod:
  'arbeitsagentur'` is permitted by the widened type/enum from Task 6.
```
