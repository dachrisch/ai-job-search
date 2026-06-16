# Local Orchestration Tuning — "product manager" Search

**Date:** 2026-06-16
**Goal:** Run the full job-search stack locally (no Docker/CI) and tune search → API → queue → crawler in isolation, then verify end-to-end, so that searching "product manager" surfaces real job listings and companies to scrape.

## Environment Setup

- MongoDB + Redis run on `servyy-test.lxd` (10.185.182.205), not localhost — required by project convention.
- Crawler (Python/Flask, port 5000), API (Express, port 3000), Frontend (Vite, port 5173) run as local processes, not containers.
- Cleaned up before starting:
  - A pile of stale `tsx watch` / `vite` / `python3 server.py` processes left running since Jun 11–12 (days-old zombies from prior sessions).
  - An orphaned `docker-proxy` process (4+ days old, no associated container) squatting on host port 27017 on servyy-test, blocking the `job-search-mongo` container from binding its port. Killed it and recreated the Mongo/Redis containers with fresh volumes per the `job-search-dev-startup` skill.
- `CRAWLER_PORT` defaults to 8000 in `crawler/config.py`, but the API expects the crawler at `localhost:5000` (`CRAWLER_SERVICE_URL` default). Must export `CRAWLER_PORT=5000` when starting the crawler locally.

## Credentials

- `.env` has `CLAUDE_API_KEY=sk-test-key` — a placeholder, unused in code (grep confirms no reference to `CLAUDE_API_KEY` in `packages/api/src`). The pipeline actually requires a real Claude API token stored **per-user** on the `User` model (`claudeApiToken`), set via `POST /api/auth/set-claude-token`.
- `SEARXNG_TOKEN` was missing from the environment entirely — without it, the private SearXNG instance (`search.lehel.xyz`) returns `200 OK` with an empty `results` array (silent failure, no error surfaced). Token is documented in memory (`searxng_source.md`) but wasn't being exported.
- The user supplied a real Anthropic OAuth token (`sk-ant-oat01-...`). The codebase already has explicit support for this in `packages/api/src/claude/auth.ts` (`buildAnthropicClient` detects the `sk-ant-oat` prefix and uses `authToken` + the `oauth-2025-04-20` beta header instead of `apiKey`).

## Pipeline Fixes

All changes verified against the existing test suite (API: 0 regressions vs. baseline; crawler: 14/14 pytest pass).

1. **SearXNG query strategy too narrow** (`packages/api/src/search-sources/searxng-source.ts`)
   - Was: single query `"<query> careers"` → results dominated by job aggregators (LinkedIn, Indeed, Stepstone), which the LLM correctly rejects as non-company-pages, yielding 0 discovered companies.
   - Fix: also query `site:greenhouse.io`, `site:lever.co`, `site:jobs.ashbyhq.com` in parallel (these ATS platforms host real per-company job postings), merge + dedupe by URL.

2. **ATS URLs point to one job posting, not the company's listing page** (same file)
   - SearXNG returns URLs like `job-boards.greenhouse.io/getyourguide/jobs/7887400` — a single posting. The crawler's spider expects a listing page with multiple job cards.
   - Fix: `normalizeCompanyUrl()` trims ATS URLs down to the company root (`.../getyourguide`), which (via redirect) lands on the company's full job board.

3. **Crawler spider selectors too narrow / had a bug** (`crawler/job_crawler/spiders/generic_career_spider.py`)
   - Added `div[class*='job']` and `a[class*='job']` as fallback container selectors — real-world career pages (e.g. Scout24's TYPO3-based board) use classes like `teaser--job` that weren't covered by the existing selector list.
   - Fixed a title-extraction bug: `[class*='title']::text` matched elements whose class contained `subtitle` (substring collision) and only read direct child text, missing titles nested inside an inner `<a>`. Added `:not([class*='subtitle'])` and an `a::text` fallback selector.
   - Verified against real fetched HTML (Scout24, GetYourGuide) before deploying — Scout24 went from 0 → 34 extracted job items.

4. **Playwright/Chromium incompatible with host OS** (`crawler/config.py`, `crawler/job_crawler/network_interceptor.py`)
   - `playwright install chromium` fails: "Playwright does not support chromium on ubuntu26.04-x64" (host OS too new for Playwright's bundled-browser support matrix).
   - Fix: added `CHROMIUM_EXECUTABLE_PATH` env var; `network_interceptor.py` passes it to `p.chromium.launch(executable_path=...)`, defaulting to `None` (unchanged behavior) when unset. Pointed it at the already-installed system `/usr/bin/google-chrome` for local dev.
   - This unblocks the SPA-network-capture fallback path (`needsDiscovery` / `discoverJobsApi`) for career pages that are pure client-rendered SPAs, though full verification of that path against a real SPA site is still outstanding.

5. **LLM validation cap too low** (`searxng-source.ts`)
   - `validateWithLLM` only validated the top 20 of the now-larger deduped result set (up to ~76 results after the multi-query change). Raised to top 40 and bumped `max_tokens` 2000 → 4000 to fit the larger response.

6. **Job-scoring JSON parse bug** (`packages/api/src/events/handlers.ts`, `jobs_extracted` handler)
   - `callClaude()` responses are sometimes wrapped in markdown code fences (` ```json ... ``` `), which broke a direct `JSON.parse(response)` call and silently fell back to default scores.
   - Fix: extract the JSON object via `response.match(/\{[\s\S]*\}/)` before parsing, matching the pattern already used in `validateWithLLM`.

## Results

Live "product manager" search runs after fixes:
- 10 companies discovered (vs. 0 before the SearXNG query fix).
- Scout24 alone yielded 22 real extracted job listings; Product People, Toast, and The Quality Group also contributed real listings.
- 3 jobs passed the keyword-relevance threshold and were scored + broadcast end-to-end (discovery → crawl → extraction → scoring → SSE broadcast) using the user's real Claude token.
- The keyword-threshold filtering itself is working as designed — most of Scout24's 22 listings are legitimately non-PM roles (legal, finance, etc.), so the low pass-through rate is correct behavior, not a bug.

## Known Gaps / Not Yet Solved

- **Target of "10 stored listings" not yet reached** — currently landing ~3 per run. Two contributing factors:
  - Several discovered companies (Workday, Airbnb, Dropbox, Rubrik) returned 0 jobs — likely pure-SPA career pages needing the Playwright network-capture fallback, which is now unblocked (Chromium path fixed) but not yet verified against a real SPA site end-to-end.
  - SearXNG/LLM company discovery has run-to-run variance — the same query can surface a different mix of ATS vs. generic-corporate-site results.
- **No terminal state when discovery pool is exhausted without hitting the jobs target** — `company_crawled` handler's expand-search logic (`events/handlers.ts` ~line 468) only queues a next batch when `companiesRemaining > 0`; if all discovered companies are crawled and the job count is still below threshold, the `SearchSession` stays `status: 'running'` indefinitely with no failure/completion event. Not fixed in this session — flagged for follow-up.
- GetYourGuide's normalized root URL turned out to be a marketing landing page (not a listings page) — the real listings live behind a nav link (`/open-roles`). Not solved; would need either a second crawl hop or smarter root-URL guessing for that specific ATS redirect pattern.

## Files Changed

- `crawler/config.py`
- `crawler/job_crawler/network_interceptor.py`
- `crawler/job_crawler/spiders/generic_career_spider.py`
- `packages/api/src/search-sources/searxng-source.ts`
- `packages/api/src/events/handlers.ts`

## Verification Commands

```bash
# API tests (0 regressions vs. baseline — pre-existing flaky failures unrelated to these changes)
cd packages/api && npm test -- --run

# Crawler tests (14/14 pass)
cd crawler && python3 -m pytest tests/ -q

# Manual end-to-end trigger (requires a registered user with a real claudeApiToken set)
curl -X POST http://localhost:3000/api/searches \
  -H "Content-Type: application/json" -H "Authorization: Bearer $JWT" \
  -d '{"query":"product manager"}'
```
