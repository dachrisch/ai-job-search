# #187 — Reach 100 valid PM jobs per search — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** One "Product Manager in Munich" search returns ~100 valid, scored, Munich PM jobs and reaches `complete`.

**Architecture:** Fix correctness/infra first (stuck sessions, quota contention, nginx, trust-proxy, CI blind spot), then quantity (multi-title Arbeitsagentur fan-out + validity filters), then presentation (stream unscored, collapse <50), then Tier-3/ATS as a time-boxed spike. Small independent PRs per phase.

**Tech Stack:** Express 5 + Mongoose + BullMQ, Arbeitsagentur v6 API (`packages/api/src/sources/`), opencode LLM client (`packages/api/src/ai/`), SSE (`routes/stream.ts`, `utils/SSEManager.ts`), React 19 + nginx (`packages/frontend/`), GitHub Actions (`ci.yml`).

**Baseline:** 52 scored jobs in ~1 min, ~16 genuinely PM-in/near-Munich; ~30/52 unrelated on one keyword; manual 8-variant × 2-page run = 52 valid.

**Locked decisions (user approved "best sensible"):**
1. PR shape: 5 PRs (A infra, B CI, C pipeline, D quantity, spike).
2. Final LLM ranking: DELETE from `search_complete`; rely on per-job `jobs_extracted` scoring.
3. Title variants: ship 5, architect for 8 (concurrency 3 + global cap).
4. Agency filter: blocklist-only now (`BLOCKLISTED_COMPANIES`, seed `alfatraining`); heuristic → logging only.
5. Low-score: collapsed-behind-toggle at 50, never hard-hide; unscored always shown.

---

## PR-A — Infra (Tasks 1–3)

### Task 1: `trust proxy` + rate-limiter test
**Files:** Modify `packages/api/src/index.ts:57-65`; Test `packages/api/src/middleware/__tests__/rate-limit.test.ts`
- Step 1: failing test with `X-Forwarded-For`.
- Step 2: `cd packages/api && npm test -- --run src/middleware/__tests__/rate-limit.test.ts` → FAIL.
- Step 3: add `app.set('trust proxy', 1)` before `globalRateLimiter`.
- Step 4: re-run → PASS; full suite green.
- Step 5: commit `fix(api): trust proxy for rate limiter behind nginx`.

### Task 2: SPA deep-link 404
**Files:** Modify `packages/frontend/Dockerfile:20-28` (+ optional `packages/frontend/nginx.conf`).
- Add `try_files $uri $uri/ /index.html;`.
- Verify: `docker build`, `curl /history` → 200.
- Commit `fix(frontend): spa fallback try_files`.

### Task 3: Contradictory failure state
**Files:** Modify `packages/frontend/src/components/StatusLine.tsx:7-15`, `packages/frontend/src/components/JobList.tsx:29-35`, `packages/frontend/src/pages/ResultsPage.tsx:46-94`.
- Step 1 (failing test in `packages/frontend/tests/ResultsPage.test.tsx`): failed + zero jobs → "Search failed" present, "No jobs found yet" absent.
- Fix: `JobList` renders nothing when `status==='failed'` (single owner).
- Commit `fix(frontend): single failure state on results page`.

## PR-B — CI blind spot (Task 4)
**Root cause:** `packages/api/tsconfig.json:11` excludes tests; `build` = bare `tsc`; `ci.yml` lint never type-checks api tests.
**Files:** Modify `.github/workflows/ci.yml:66-89`; fix 33 errors.
- Reproduce via temp config including tests; add CI `tsc --noEmit` with tests; fix file-by-file; `npm test -- --run` after each.
- Commit `chore(ci): typecheck tests; fix 33 tsc errors`.

## PR-C — Pipeline correctness (Tasks 5–7)
### Task 5: `search_complete` must not hang
**Files:** `packages/api/src/events/handlers.ts:1124-1216`, `packages/api/src/ai/opencode.ts`, `packages/api/src/events/sweeper.ts`.
- Decision: DELETE ranking LLM call; `search_complete` = mark complete + broadcast. Failing test: mocked hanging LLM → still `complete` <10s.

### Task 6: Stream unscored jobs immediately
**Files:** `handlers.ts:78-103`, `:606-615`, `utils/SSEManager.ts`, `hooks/useSSE.ts:69-78`, `components/JobCard.tsx`, `shared/src/types.ts:19`, `db/models.ts:21`.
- Broadcast Tier-1/company jobs with `matchScore: null` before scoring; upsert scores later; sort unscored last.

### Task 7: LLM quota serialization
**Files:** `ai/opencode.ts` (semaphore max 2), `events/queue.ts`, `handlers.ts` (score Tier-1 before Tier-2 discovery).
- Test: concurrent mocks → max concurrency; exhausted-free → paid once.

## PR-D — Quantity & quality (Tasks 8–10)
### Task 8: Title-variant fan-out (ship 5)
**Files:** `sources/query-parser.ts` (+`expandTitleVariants`), `sources/arbeitsagentur-source.ts` (variant loop, concurrency 3, global cap 400), `sources/manager.ts`, `sources/__tests__/arbeitsagentur-source.test.ts`.

### Task 9: Validity filters
**Files:** `shared/src/types.ts` (+`publishedAt?`), `db/models.ts`, `sources/arbeitsagentur-source.ts:66-83`, `handlers.ts:78-103`, new `sources/validity-filter.ts` + test.
- Rules: age >6mo → drop; dedupe title+company normalized → keep newest; `BLOCKLISTED_COMPANIES`; agency heuristic → log-only pipeline event.

### Task 10: Collapse low-score
**Files:** `pages/ResultsPage.tsx:54`, `components/JobList.tsx`, `tests/ResultsPage.test.tsx`.
- Threshold 50 collapsed behind toggle; unscored always shown.

## Spike — Tier-3 ATS + SearXNG diagnosis
- Instrument raw vs validated SearXNG counts; prototype Personio adapter behind `ENABLE_TIER3=false`; go/no-go on ~10 valid/search.

## Verification per PR
- `cd packages/api && npm test -- --run` + `RUN_INTEGRATION_TESTS=true` where touched
- `npm run build --workspace=@job-search/shared && npm run build --workspace=@job-search/api && npm run build --workspace=@job-search/frontend`
- Manual PM-Munich on servyy-test: valid-count, `complete` reached, no paid fallback, reload `/search/:id` works.
