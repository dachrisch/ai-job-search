# Layered Job-Source Strategy — Design

**Date:** 2026-06-19
**Status:** Approved (design); implementation pending
**Supersedes the strategy in:** the adapter/company-centric direction of
`2026-06-10-company-careers-crawler-redesign.md` and `2026-06-16-career-site-adapters-design.md`.

## Problem

The goal is unchanged: **find software/tech jobs across the web, DACH-focused** —
not just on a fixed set of sites.

The current system tries to *manufacture* breadth by crawling individual company
career pages and matching their URLs to per-platform adapters. Two structural failures:

1. **No breadth backbone.** Coverage equals "companies whose career-page URL matches
   one of 8 adapters." The crawler site survey (2026-06-17) scored **1/30** real sites
   working through the generic spider.
2. **Discovery↔adapter seam mismatch.** Discovery yields *branded* career pages
   (`careers.company.com`); adapters need *raw ATS* URLs (`boards.greenhouse.io/...`).
   Nothing bridges them, so the adapters rarely fire on discovered URLs.
3. **Two competing pipelines** coexist in a 1,010-line `handlers.ts`, and the
   architecture docs describe neither accurately.
4. **Selector rot** — HTML scrapers (HeiseJobs, StepStone) silently break on redesign.

## Decisions (from brainstorming)

- **Audience:** personal-first (priority 1 = the user's own job search); possibly
  public later. Design must not *architecturally* preclude a future public version,
  but may use personal-scale techniques now.
- **Job scope:** software/tech roles, **DACH-focused** — a well-bounded problem.
- **Techniques in scope:** **LLM-as-extractor on arbitrary pages** and **free job APIs**.
  Out of scope (for now): headless browser (Playwright) and the user's logged-in
  sessions. Consequence: pure client-side SPA sites stay partly out of reach via raw
  HTTP; APIs + server-rendered extraction compensate for most of it.
- **Direction:** **Layered combination** — APIs (breadth) + search-and-LLM-extractor
  (long tail) + the durable JSON ATS adapters (company-direct), behind one interface.
- **Sequencing:** **Thin end-to-end slice first** (one API source through the existing
  scoring/frontend pipeline), then add tiers.

## Core architecture: a query-based source abstraction

Replace the crawl-centric source model (`canHandle(domain)`, `scrapeBulk(urls)`) with
a **query-centric** one. The crawl-centric model is the root cause: APIs are query-in /
jobs-out, the opposite of "here are URLs, go scrape them."

```ts
interface JobSource {
  name: string
  tier: 1 | 2 | 3                                  // API | search+LLM | ATS adapter
  search(query: JobQuery): Promise<SourceResult>   // query in, jobs out
}

interface JobQuery {
  keywords: string
  location?: string
  radius?: number      // km, DACH-aware
  remote?: boolean
  raw: string          // original user query
}

interface SourceResult {
  source: string
  jobs: Job[]
  errors: Array<{ message: string }>
}
```

A `SourceManager` fans out to all enabled sources **in parallel**, merges results, and
**dedupes by normalized URL** (with a title+company fuzzy fallback, since the same job
appears on Arbeitsagentur *and* on a company's ATS board). It returns one merged `Job[]`.

```
                         ┌─────────────────────────────┐
   search_started  ─────▶│        SourceManager        │
   (query, userId)       │   fan-out ∥  merge  dedupe   │
                         └──┬─────────┬─────────┬───────┘
              Tier 1 (API)  │ Tier 2  │ Tier 3  │
        ┌───────────────────▼┐ ┌──────▼──────┐ ┌▼────────────────┐
        │ ArbeitsagenturSource│ │ LlmExtractor│ │ Greenhouse/Lever│
        │ AdzunaSource        │ │ (SearXNG +  │ │ Ashby/Personio  │
        │                     │ │  Claude)    │ │ (JSON only)     │
        └─────────────────────┘ └─────────────┘ └─────────────────┘
                         │ merged Job[]
                         ▼
        store Jobs ─▶ emit jobs_extracted ─▶ [EXISTING: Claude scoring
                                              ─▶ results_ready ─▶ SSE ─▶ frontend]
```

**Key property:** everything below the insertion point is already source-agnostic and
stays unchanged. Tiers are independently buildable/testable behind one method. Adding or
removing a source is a registry edit, not a pipeline change.

## Slice #1 — `ArbeitsagenturSource` end-to-end

Prove the model with the least new code by plugging one Tier-1 API source into the
existing scoring/frontend pipeline.

**Source:** Bundesagentur für Arbeit "Jobsuche" API — public, free, no signup (well-known
public API-key header). Query-native; ideal for DACH software roles.

- `search({keywords, location, radius})` →
  `GET …/jobsuche-service/pc/v4/jobs?was=<keywords>&wo=<location>&umkreis=<radius>&size=<n>`
- Field mapping (the contract; exact endpoint/param/field names verified live during
  implementation):

  | `Job` field   | Arbeitsagentur field            |
  |---------------|---------------------------------|
  | `title`       | `titel` / `beruf`               |
  | `company`     | `arbeitgeber`                   |
  | `location`    | `arbeitsort.ort` (+ region)     |
  | `url`         | detail link built from `refnr`  |
  | `sourceUrl`   | `"arbeitsagentur"`              |
  | `description` | from job-detail call (lazy/optional in slice #1) |

The source is a **pure isolated unit**: query in, `Job[]` out, no DB/event knowledge.
Unit-tested against recorded API fixtures — no live network in unit tests.

### Data flow for the slice (additive — nothing existing breaks)

```
search_started
   ├─ (existing company-centric path keeps running for now)
   └─ NEW: SourceManager.search(query)            // slice #1 = ArbeitsagenturSource only
          → store returned Jobs (searchSessionId, discoveryMethod:'arbeitsagentur')
          → emit jobs_extracted({ searchId, jobIds })   // ← joins existing pipeline
```

Three deliberate decisions:

1. **Reuse the keyword gate, but drop the hard 0.4 threshold for API sources.** API
   results are already query-filtered by the provider; a lexical 0.4 gate would wrongly
   discard good German-language matches. Tier-1 stores all; existing Claude scoring ranks
   them. (The lexical gate stays useful for noisier Tier-2 later.)
2. **Dedup at store time** by normalized URL, scoped to the search session.
3. **`session.jobsExtracted`** increments as before, so existing "expand search" logic
   and SSE progress keep working.

Net new code for the slice: the `JobSource`/`JobQuery`/`SourceResult` types,
`ArbeitsagenturSource`, a minimal one-source `SourceManager`, and ~10 lines added to the
`search_started` handler. Everything else is reuse.

## Keep / retire / change

The endgame is **one pipeline**. The slice is additive; nothing is removed until the new
path proves itself. Each retirement is a separate, reviewed step — never a silent cleanup.

**Keep (unchanged):**
- Downstream: `jobs_extracted` → Claude scoring → `results_ready_for_frontend` → SSE →
  frontend, and the `searches` routes.
- The durable **JSON** ATS adapters (Greenhouse, Lever, SmartRecruiters, Personio) —
  rehomed as Tier-3 sources behind the new interface.

**Retire (phased, only after Tier-1 proves out):**
- **Pipeline B**: `JobSourceManager`, `CrawlerSource`, `PageAnalyzer`, `search-service`,
  and the `search_query_performed` / `pages_analyzed` / `crawl_requested` / `jobs_scraped`
  / `crawl_deeper` handlers.
- **Brittle HTML scrapers**: `GenericCareerPageSpider`, `StepStoneAdapter`,
  `HeiseJobsAdapter`, generic spiders. Tier-2 LLM-extractor replaces their purpose
  without selector rot.
- Likely the **company-centric crawl path** (`companies_queued_for_crawl` →
  `crawl_company` → `company_crawled`) once Tier-3 adapters run query-first.

**Change:**
- `search_started` becomes a thin dispatcher to `SourceManager`.
- The Python crawler service shrinks (from Scrapy-spider host to, at most, a stateless
  "fetch + readability" helper for Tier-2) or is retired entirely if Tier-2 fetches in
  Node. **Deferred** to when Tier-2 is built.

## Error handling — fail-soft, per-source isolation

Fan-out changes the failure model: one dead source must not kill a search.

- `SourceManager` wraps each source in its own try/catch + timeout; a source failure
  becomes a `SourceResult.errors` entry, not a thrown exception.
- A search only fails (`search_failed`) if **all** sources fail. Partial results are
  normal and surfaced.
- Per-source timeouts: APIs ~5s; Tier-2 LLM longer.

## Testing — TDD, no live network in unit tests

- `ArbeitsagenturSource`: unit tests against **recorded JSON fixtures** — happy path,
  empty results, malformed payload, field-mapping edge cases (missing employer/location).
- `SourceManager`: parallel fan-out, merge, **URL dedup**, per-source failure isolation
  (one source throws → others still return).
- One **opt-in live integration test** (behind a flag, like the existing
  `RUN_INTEGRATION_TESTS`) hitting the real API to catch contract drift.
- Existing scoring/SSE tests stay green — proves the additive slice doesn't regress.

## Future tiers (sketch only — each its own spec → plan → build cycle)

- **Tier 2 — LLM-extractor:** SearXNG query → fetch top server-rendered pages → Claude
  extracts `Job[]` from raw content; token-trimmed via readability strip. Node-fetch vs.
  reusing the Python service decided then.
- **Tier 3 — durable adapters:** wrap JSON ATS adapters as query-first sources; add
  **Ashby** (2700+ companies, free public API) as the high-ROI addition.

## Out of scope

- Headless-browser rendering and logged-in-session crawling.
- A public multi-user hardening pass (rate limiting, token encryption, etc.) — tracked
  separately; not part of this strategy.
- Building Tiers 2 and 3 (separate specs).
```
