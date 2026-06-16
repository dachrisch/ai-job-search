# Career Site Custom Adapters — Design

**Date:** 2026-06-16
**Supersedes:** `2026-06-15-spa-api-discovery-design.md` (the Playwright-based live SPA discovery feature, PR #43). This design replaces that approach.

## Problem

The generic Scrapy spider (`crawler/job_crawler/spiders/generic_career_spider.py`) cannot extract job listings from career pages that are pure client-rendered SPAs (Workday, Airbnb, Dropbox, Rubrik all returned 0 jobs in the 2026-06-16 "product manager" search run). The current fix for this (PR #43) launches a headless Chromium browser via Playwright at crawl time, sniffs XHR/fetch traffic for job-list-shaped JSON, and asks Claude to infer an endpoint config live, which is then cached per-company and replayed by a generic `DirectFetcher`.

This live-discovery approach has two problems:
1. **Image bloat / complexity** — the crawler's Docker image installs both `chromium` and `firefox-esr` plus their system dependencies solely to support this one fallback path.
2. **Fragility** — LLM-inferred endpoint configs are confidence-scored guesses, re-derived (and re-paid-for) per company, and silently produce wrong or empty results when the guess is slightly off.

In practice there are a small, finite number of ATS/career-page platforms (Workday, Greenhouse, Lever, SmartRecruiters, Ashby, iCIMS, custom in-house, etc.). A handful of hand-investigated, hand-written adapters can cover most real-world SPA career pages without any browser dependency or live LLM guessing at crawl time.

## Goals

- Remove the Playwright-based live discovery path entirely (de-bloat the crawler image, remove the LLM-guessing failure mode).
- Let the crawler tag companies whose career pages it can't extract jobs from, so they form a backlog for investigation.
- Provide a registry of custom, hand-built adapters for known ATS platforms that the crawler tries before falling back to the generic spider.
- Establish a repeatable, subagent-driven workflow for investigating a new tagged site and producing a reviewed, tested adapter.

## Non-goals

- Fully automating adapter creation with no human review — adapters are reviewed before merge.
- Covering every possible bespoke in-house career page — only platforms common enough to be worth a dedicated adapter get one. Sites that remain unsupported simply stay tagged.

## Architecture

### Crawler-side adapter system (Python)

New package `crawler/job_crawler/adapters/`:

- **`base.py`** — abstract class `CareerSiteAdapter` with four lifecycle hooks:
  - `can_handle(url: str) -> bool` — URL/domain pattern match (e.g. `*.myworkdayjobs.com`).
  - `authenticate(url: str) -> AuthContext` — acquire any session/token/cookie needed before fetching; default no-op returning an empty context.
  - `fetch_page(url: str, keywords: str, auth_context: AuthContext, page_token: str | None) -> RawPage` — perform one HTTP request (GET/POST/GraphQL, whatever the platform needs) and return the raw response.
  - `parse_jobs(raw_page: RawPage) -> tuple[list[JobDict], str | None]` — extract job dicts and an optional next-page token from one raw page.

  The base class provides a `run(url, keywords) -> list[JobDict]` orchestrator: calls `authenticate` once, then loops `fetch_page` → `parse_jobs` following pagination tokens, capped at a fixed max page count (10) as a safety bound.

- **`registry.py`** — an ordered list of adapter instances; `find_adapter(url) -> CareerSiteAdapter | None` returns the first adapter whose `can_handle(url)` is true.

No concrete adapters ship with this design — the registry starts empty (or with a no-op placeholder) and is populated by the workflow in the "Subagent-driven adapter creation" section below, starting with the four known-failing companies.

### Crawl flow changes (`crawler/cli.py`)

In `_run_company_crawl_worker`:

1. Call `find_adapter(url)` first.
2. If matched: run `adapter.run(url, keywords)`, return its jobs. Skip Scrapy entirely.
3. If no adapter matches: run the generic Scrapy spider as today.
4. If the generic spider returns 0 jobs (and no exception occurred), the result includes `"unsupported": true` instead of today's `needs_discovery`/`network_capture` fields. No Playwright call is made.

`crawler/models.py`'s `CompanyCrawlResult` drops `needs_discovery` and `network_capture`, adds `unsupported: bool` (default `False`).

### API-side changes (TypeScript)

- `Company.status` enum gains a new value: `'unsupported'`, alongside the existing `pending_crawl | crawling | crawled | failed` (`packages/api/src/models/company.ts`, `packages/shared/src/types.ts`).
- `crawl_company` event handler (`packages/api/src/events/handlers.ts`): remove the `needsDiscovery`/`discoverJobsApi`/cached-`discoveredApi`/`DirectFetcher` branches (lines ~282–366 today).
- `company_crawled` event handler: accept a new `unsupported: boolean` field on the event payload; when true, set `company.status = 'unsupported'` instead of `'crawled'`.

### Removals

- `crawler/job_crawler/network_interceptor.py` and its test (`crawler/tests/test_network_interceptor.py`).
- `CHROMIUM_EXECUTABLE_PATH` from `crawler/config.py`.
- `playwright` from `crawler/requirements.txt`.
- `chromium`, `firefox-esr`, and their apt dependencies from `crawler/Dockerfile` (revert to a plain `python:3.14-slim` image with no browser install step).
- `packages/api/src/discovery/api-discoverer.ts` + test.
- `packages/api/src/discovery/direct-fetcher.ts` + test.
- `discoveredApi` field from the `Company` schema/type and the `DiscoveredApiConfig` type from `packages/shared/src/types.ts`.

### Subagent-driven adapter creation workflow

This is a manual, on-demand process, not an automatic trigger:

1. Query companies with `status: 'unsupported'` (Mongo find, or a small script). Group by apparent platform where possible (URL pattern, e.g. `*.myworkdayjobs.com`).
2. For each *unique platform* worth covering, dispatch a subagent to investigate one representative company's real career page: capture the actual network requests the page makes (chrome-devtools MCP tools, or WebFetch against likely API endpoints) to determine the request shape (method, auth, pagination, response structure).
3. The subagent writes `crawler/job_crawler/adapters/<platform>.py` implementing the four lifecycle hooks, plus a pytest test built from a captured fixture response (no live network calls in tests).
4. I review the generated adapter and test before adding it to `registry.py` / merging.
5. Once merged, reset affected companies' status back to `pending_crawl` so the next crawl cycle exercises the new adapter.

The first batch targets the four companies already known to fail: Workday, Airbnb, Dropbox, Rubrik — likely yielding at most 2-3 adapters (Airbnb/Dropbox/Rubrik may share a platform, or may turn out to be one-offs not worth covering).

## Data flow (after this change)

```
crawl_company_requested
  → cli.py: find_adapter(url)
      → matched  → adapter.run() → jobs (or [] if adapter itself fails)
      → no match → generic Scrapy spider
                      → jobs found  → return jobs, unsupported=false
                      → 0 jobs      → return jobs=[], unsupported=true
  → handlers.ts company_crawled
      → unsupported=true  → Company.status = 'unsupported'
      → otherwise         → Company.status = 'crawled' (existing behavior)
```

## Error handling

- An adapter's `authenticate`/`fetch_page`/`parse_jobs` raising an exception is caught by the `run()` orchestrator and treated as "adapter failed" — falls through to the generic spider rather than crashing the crawl (mirrors today's defensive try/except pattern in `_run_company_crawl_worker`).
- A genuinely broken/unreachable site (network error, timeout, non-2xx with no recoverable data) still produces a `'failed'` `Company.status` via the existing top-level `catch` block in `handlers.ts` — `'unsupported'` is reserved for "the crawl completed but extracted nothing," matching the distinction already requested.

## Testing

- New pytest unit tests per adapter, with mocked/fixture HTTP responses — no live network calls in CI.
- Existing crawler test suite (currently 14/14 passing) updated: remove `test_network_interceptor.py`, update `test_models.py` for the `unsupported` field replacing `needs_discovery`/`network_capture`.
- API test suite: remove `api-discoverer.test.ts` and `direct-fetcher.test.ts`; update `crawl-company-handler.test.ts` to drop discovery-path assertions and add coverage for the `unsupported` → `Company.status` transition.

## Files touched

**Crawler (Python):**
- `crawler/job_crawler/adapters/base.py` (new)
- `crawler/job_crawler/adapters/registry.py` (new)
- `crawler/job_crawler/adapters/<platform>.py` (new, per investigated platform — produced by the subagent workflow, not part of this initial implementation)
- `crawler/cli.py` (adapter dispatch in `_run_company_crawl_worker`)
- `crawler/models.py` (`CompanyCrawlResult` field changes)
- `crawler/config.py` (remove `CHROMIUM_EXECUTABLE_PATH`)
- `crawler/requirements.txt` (remove `playwright`)
- `crawler/Dockerfile` (remove chromium/firefox-esr install)
- Delete: `crawler/job_crawler/network_interceptor.py`, `crawler/tests/test_network_interceptor.py`
- Update: `crawler/tests/test_models.py`

**API (TypeScript):**
- `packages/api/src/models/company.ts` (status enum)
- `packages/shared/src/types.ts` (status enum, remove `DiscoveredApiConfig`, remove `discoveredApi` field)
- `packages/api/src/events/handlers.ts` (remove discovery branch, handle `unsupported` flag)
- Delete: `packages/api/src/discovery/api-discoverer.ts`, `packages/api/src/discovery/__tests__/api-discoverer.test.ts`
- Delete: `packages/api/src/discovery/direct-fetcher.ts`, `packages/api/src/discovery/__tests__/direct-fetcher.test.ts`
- Update: `packages/api/src/events/__tests__/crawl-company-handler.test.ts`
