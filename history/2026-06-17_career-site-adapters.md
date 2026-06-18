# Career Site Custom Adapter System

**Date:** 2026-06-17
**Plan:** `docs/superpowers/plans/2026-06-16-career-site-adapters.md`
**Spec:** `docs/superpowers/specs/2026-06-16-career-site-adapters-design.md`

## Problem

The crawler relied on Playwright (headless Chromium) to discover job APIs on SPA career sites. This added ~200MB of Docker bloat (chromium + firefox-esr), required per-company LLM endpoint-config guessing, and was unreliable. The API side mirrored this with a `discovery/` module that tried to infer API endpoints dynamically.

## Solution

Replaced the entire Playwright / LLM-discovery stack with a lightweight adapter registry system:

- **Crawler:** New `CareerSiteAdapter` ABC with `can_handle`/`authenticate`/`fetch_page`/`parse_jobs` hooks + an ordered `ADAPTER_REGISTRY`. The worker tries adapters first, falls back to the generic Scrapy spider, then marks the company `unsupported` if neither finds jobs.
- **API:** Removed the `discovery/` module entirely. `company_crawled` now sets `Company.status = 'unsupported'` (new status value) instead of always `'crawled'`.

## Files Changed

### New (crawler)
- `crawler/job_crawler/adapters/__init__.py` — package marker
- `crawler/job_crawler/adapters/base.py` — `CareerSiteAdapter` ABC + `run()` orchestrator (paginated, capped at 10 pages)
- `crawler/job_crawler/adapters/registry.py` — `ADAPTER_REGISTRY` list + `find_adapter(url)`
- `crawler/tests/test_adapters_base.py` — 5 tests
- `crawler/tests/test_adapters_registry.py` — 3 tests
- `crawler/tests/test_cli_adapter_dispatch.py` — 4 tests

### Modified (crawler)
- `crawler/models.py` — removed `CapturedRequest`, replaced `needs_discovery`/`network_capture` with `unsupported: bool`
- `crawler/tests/test_models.py` — 2 tests for `unsupported` field
- `crawler/cli.py` — added `find_adapter` import, `_try_adapter()` helper, rewrote `_run_company_crawl_worker`; removed `import asyncio`
- `crawler/config.py` — removed `CHROMIUM_EXECUTABLE_PATH` / Playwright section
- `crawler/requirements.txt` — removed `playwright==1.60.0`, `pytest-asyncio==0.24.0`
- `crawler/Dockerfile` — removed chromium/firefox-esr apt installs

### Deleted (crawler)
- `crawler/job_crawler/network_interceptor.py`
- `crawler/tests/test_network_interceptor.py`

### Modified (API)
- `packages/shared/src/types.ts` — added `'unsupported'` to `Company.status`, removed `DiscoveredApiConfig` interface and `discoveredApi` field
- `packages/api/src/db/models.ts` — removed `discoveredApiSchema`, added `'unsupported'` to `companySchema.status` enum
- `packages/api/src/events/handlers.ts` — removed discovery imports/branches from `crawl_company`, `company_crawled` sets status conditionally
- `packages/api/src/events/__tests__/crawl-company-handler.test.ts` — rewritten (5 tests)

### Deleted (API)
- `packages/api/src/discovery/` (api-discoverer.ts, direct-fetcher.ts, their tests)

## Commits

```
123de13 refactor(crawler): replace needs_discovery/network_capture with unsupported flag
fe390f0 feat(crawler): add CareerSiteAdapter base class
54eac0d feat(crawler): add adapter registry with ordered URL matching
3b111f8 feat(crawler): add _try_adapter dispatch helper
20849de feat(crawler): dispatch to adapter registry before generic spider
882a248 chore(crawler): remove Playwright and its Docker dependencies
6d6c322 feat(shared): add unsupported Company status, remove DiscoveredApiConfig
1bc6767 feat(api): add unsupported to Company status enum, drop discoveredApi schema
26ccef4 chore(api): remove discovery module
cf696cb feat(api): simplify crawl_company, tag unsupported companies
```

## CI Fixes (same session)

Two separate issues fixed:

### 1. `search-sources.test.ts` — 13 pre-existing failures
**Root cause:** `searchSearXNG` fires 4 parallel `axios.get` calls via `Promise.all` (1 "careers" + 3 ATS domains). Tests used `mockResolvedValueOnce` (mocks one call); calls 2-4 returned `undefined`, causing `.then()` to throw.
**Fix:** Added `vi.mocked(axios.get).mockResolvedValue({ data: { results: [] } })` in `beforeEach` as default. Also corrected `slice(0, 40)` → `slice(0, 20)` in `searxng-source.ts` to match the "top 20" test spec.

### 2. `discovery-integration.test.ts` — 3 local-only failures (skipped in CI)
**Root cause:** Test user IDs like `'test-user-123'` are not valid MongoDB ObjectIds. `UserModel.findById()` throws a CastError.
**Fix:** Replaced with 24-char hex strings (`'000000000000000000000001'` etc.).

### 3. Automerge deadlock (PR #50)
**Root cause:** `gh pr checks --watch` in the automerge workflow waits for ALL checks, including the `automerge` check itself — a self-deadlock.
**Fix:** Added `--required` flag to `gh pr checks --watch --required` so it only waits for branch-protection required checks (the CI jobs), not its own workflow.

```
1f9082d fix(api): fix pre-existing test failures in search-sources and discovery-integration
50addaf fix(ci): prevent automerge deadlock by watching only required checks
```

## Verification

- Crawler: 14/14 tests pass
- API (CI mode): 124/124 tests pass (38 skipped — integration tests excluded)
- Shared + frontend builds: clean
- No stray references to removed symbols (`discoverJobsApi`, `DiscoveredApiConfig`, `network_interceptor`, `CHROMIUM_EXECUTABLE_PATH`, `needs_discovery`, `CapturedRequest`)
- CI green on master

## Known Limitations

- `ADAPTER_REGISTRY` is empty — concrete adapters for Workday, Greenhouse, Lever etc. are the next step (per design spec)
- `Company.status = 'unsupported'` is stored but not yet surfaced in the frontend UI
