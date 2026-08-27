# Search Platform Audit — Findings & Fix Plan

**Date:** 2026-08-26
**Scope:** Live-site audit of `https://jobs.lehel.xyz/` (register → run queries → observe pipeline insights) cross-referenced against the repository code.
**Status:** Phases 0–3 implemented (PRs #144, #146). Phases 4–5 implemented on `feat/search-pipeline-phases-4-5` (PR #147).

---

## How the audit was performed

1. Registered a throwaway account on `jobs.lehel.xyz` (`/api/auth/register`).
2. Created **3 searches** ("Python backend developer remote", "React frontend developer", "Kubernetes platform engineer") and monitored each for 30+ minutes via:
   - `GET /api/searches/:id/status`
   - `GET /api/searches/:id/insights`
   - `GET /api/searches/:id/stream` (SSE)
3. Probed the full API surface for endpoints the UI does not expose (profile, history, etc.).
4. Compared observed behavior against the code in `packages/api`, `packages/frontend`, and `packages/shared`.

The deployed frontend bundle matches the current repo, so live behavior reflects this codebase.

---

## Grouped & prioritized findings

Priority legend: 🔴 P0 (blocks the core product from producing results) · 🟠 P1 (data correctness/persistence) · 🟡 P2 (account & history UX) · 🟠 P3 (security hardening) · 🟢 P4 (observability)

### 🔴 P0 — The product produces no results

| # | Finding | Evidence |
|---|---------|----------|
| A1 | **Searches get stuck `running` forever — event queue is not processed.** All 3 audited searches showed `status: running` with 0 pipeline events, 0 companies, 0 jobs after 30+ min; the SSE stream only ever sent the initial `sync` + heartbeats. Two contributing causes in code: the BullMQ `Worker` is created with default **`concurrency: 1`** (`packages/api/src/events/queue.ts:75`), and `search_started` runs the *entire* discovery loop synchronously (2 rounds × 6 queries × 3 SearXNG pages + several opencode calls) — so a single slow/stuck search blocks the whole queue. Additionally `searches.ts:32` enqueues events **fire-and-forget with a silent catch** — if Redis enqueue fails, the session stays `running` forever with no error surfaced. | `queue.ts:75`, `handlers.ts:37-129`, `searches.ts:32` |
| A2 | **No timeout / failure surfacing for stuck searches.** Nothing transitions a stalled session to `failed`; no sweeper, no per-search deadline. Users see "running" indefinitely with no explanation or recovery path. | `handlers.ts` (no `search_failed` path for stalls), `searches.ts` |
| B1 | **Keyword filter rejects nearly all crawled jobs.** `calculateKeywordMatch` is naive English substring/word matching with a hard threshold of 0.4 (`packages/api/src/utils/job-matcher.ts`). German job titles/descriptions (DACH market via Arbeitsagentur) rarely match English queries ("entwickler" ≠ "developer", inflections, compound words), so most crawled jobs are silently dropped → **"companies crawled but no jobs reported"**. | `job-matcher.ts:31-119`, `handlers.ts:429-450` |
| B2 | **Stats vs results inconsistency.** `company_crawled` increments `session.jobsExtracted += data.jobs.length` (`handlers.ts:489`) counting *all* crawled jobs, while only jobs passing the keyword filter are stored. The UI can therefore show "Jobs Extracted: N" while the results list is empty, and `jobsScored` counts submitted job IDs regardless of how many the LLM actually scored. | `handlers.ts:489`, `handlers.ts:589`, `routes/searches.ts:104-126` |

### 🟠 P1 — Data correctness & persistence

| # | Finding | Evidence |
|---|---------|----------|
| C1 | **Companies are global, keyed by `searchQuery` string, not by user/session.** `Company` has no `userId`/`searchSessionId`; it is unique by URL, upserted and overwritten on each discovery, and `status` is reset to `pending_crawl` every time → no reuse across searches. Every search re-discovers and re-crawls from scratch (matches reported behavior). | `db/models.ts:47-69`, `handlers.ts:160-181` |
| C2 | **Join-key mismatch between companies and sessions.** Insights (`routes/insights.ts:29`) and crawl-batch selection (`handlers.ts:505`) query companies by the `searchQuery` string while jobs are scoped by `searchSessionId`. Identical query strings from different users/sessions share records; slightly different query strings hide otherwise-stored companies; crawl batches can cross-contaminate sessions. | `insights.ts:28-34`, `handlers.ts:505-509` |
| B3 | **Final ranking is never applied.** `search_complete` calls opencode for a final ranking but only pushes the reply to `conversationHistory`; `matchScore` is never updated from it. | `handlers.ts:1052-1071` |
| A3 | **No per-job error isolation.** `company_crawled` saves jobs in a loop with no per-item try/catch; a single job missing a required field (`sourceUrl`, `location`, …) throws and fails the whole handler → `search_failed`. Job dedup is only within a session (one `findOne` by URL per session), with no unique index → duplicates across searches. | `handlers.ts:429-450`, `db/models.ts:12-31` |

### 🟡 P2 — User account & search history

| # | Finding | Evidence |
|---|---------|----------|
| D1 | **No profile endpoints.** `GET/PATCH /api/auth/me`, change-password, delete-account, and server-side logout all return 404. Logout is client-side only (clears localStorage); the JWT remains valid for its full 7-day lifetime. | `routes/auth.ts` (register/login only), `hooks/useAuth.ts:34-37` |
| D2 | **No search history / resume.** `GET /api/searches` (list) returns 404; there is no UI to browse, re-open, or resume past searches. | `routes/searches.ts` (no list route) |
| D3 | **No URL routing — refresh loses the search.** The app is a pure `useState` SPA (`App.tsx`); search/result state lives only in React state, so a browser refresh drops the user back to login, results are not deep-linkable/shareable, and "Retry" always creates a brand-new search. | `App.tsx` |

### 🟠 P3 — Security hardening

| # | Finding | Evidence |
|---|---------|----------|
| E1 | **1-character passwords accepted** (verified live: HTTP 201). No minimum length, no strength policy, no rate limiting on register/login (accounts created freely). | `auth.controller.ts:4-34` (only presence checks), `auth.service.ts:8-19` |
| E2 | **Token handling weaknesses.** JWT stored in localStorage (XSS-exfiltratable); no server-side revocation; the SSE stream passes the JWT as a **query parameter** (`stream?token=…`) which can leak into access logs/referrers. | `useSSE.ts:41`, `routes/stream.ts:77-90` |
| E3 | **No global rate limiting.** Combined with the concurrency-1 worker (A1), any client can enqueue unbounded searches and effectively DoS the pipeline for all users. | `index.ts` (no rate-limit middleware) |

### 🟢 P4 — Observability

| # | Finding | Evidence |
|---|---------|----------|
| F1 | **`GET /api/health` only returns `{status:'ok'}`** — no dependency checks (MongoDB, Redis, crawler, opencode). No structured logging, metrics, migrations, or backups. | `index.ts:35-37`, `docs/FEATURES.md` |

---

## Fix plan (phased)

Implementation order mirrors priority. Each phase is a follow-up PR against this branch; this PR documents the plan only.

### Phase 0 — Pipeline reliability (A1, A2) — ✅ implemented
- ✅ Set an explicit BullMQ worker `concurrency` (5) and add retry/backoff (`attempts: 3`, exponential) + a dead-letter strategy in `queue.ts`. Exhausted retries also mark the owning session `failed` with a stored reason + SSE error.
- ✅ Enforce an overall per-search deadline plus per-LLM-call timeouts (per-LLM timeouts already existed in `opencode.ts`; the deadline is enforced by the sweeper).
- ✅ Make event enqueue from `searches.ts` non-silent: on enqueue failure the session is saved as `failed` with `failureReason` and the API returns 503 (fire-and-forget `.catch` removed).
- ✅ Add a **sweeper** (`events/sweeper.ts`) that marks `running` sessions older than N minutes (default 30) as `failed` with a stored reason and SSE error broadcast; started from `index.ts`.
- ✅ Handlers bail out early when a session is no longer `running`, and terminal handlers rethrow so retries stay meaningful.

### Phase 1 — Jobs actually appear (B1, B2, B3, A3) — ✅ implemented
- ✅ Rewrite `calculateKeywordMatch`: German + English stemming/lemmatization, German↔English concept mapping ("entwickler" == "developer"), word-boundary tech-token matching ("react", "kubernetes"), stopword filtering. **Falls back to storing unfiltered jobs when 0 pass the filter** so the LLM scorer is the real relevance judge.
- ✅ Track stored-vs-filtered counts: `jobsExtracted` counts stored jobs, new `jobsFilteredOut` reflects reality, `jobsScored` counts actually-scored jobs.
- ✅ Parse and apply the final ranking response in `search_complete` to update `matchScore`.
- ✅ Add per-job try/catch in `company_crawled`; skip invalid/duplicate jobs instead of failing the whole search.
- ✅ Expose `jobsFilteredOut`/`failureReason` via status, stream (SSE sync), and insights endpoints; added to `SearchSession` schema + shared types.

### Phase 2 — Persistence & scoping (C1, C2) — ✅ implemented
- ✅ Add `searchSessionId` to `Company` (indexed); join companies ↔ sessions by session ID in insights and crawl-batch selection; keep `searchQuery` as discovery metadata only.
- ✅ Reuse crawls: stale re-crawl for companies older than 7 days (honor `lastCrawlTime`).
- ✅ Fix `confidence` field now in Mongoose schema (was silently stripped on save).

### Phase 3 — Account & history UX (D1, D2, D3) — ✅ implemented
- ✅ `GET/PATCH /api/auth/me`, `POST /api/auth/change-password`, `POST /api/auth/logout` (in-memory token denylist), `DELETE /api/auth/me`.
- ✅ `GET /api/searches` lists the authenticated user's sessions (status, query, timestamps).
- ✅ URL routing (`/search/:id`, `/search/:id/insights`) with React Router; results hydrated from API on mount (survives refresh).

### Phase 4 — Security (E1, E2, E3) — ✅ implemented
- ✅ **E1 — Password policy**: `validatePassword` enforces a minimum length of 8 (`MIN_PASSWORD_LENGTH`) and rejects the top ~100 most common passwords on register (`src/auth/password-policy.ts`, enforced in `auth.controller.ts` + `auth.service.ts`). `change-password` (added in Phase 3) should call `validatePassword` before hashing.
- ✅ **E2 — Token handling**: `verifyToken` now validates the JWT `issuer`/`audience` (`JWT_ISSUER`/`JWT_AUDIENCE`, defaulting to `ai-job-search` / `ai-job-search-clients`); tokens missing or with wrong claims are rejected. Note: replacing the SSE `?token=` query-param JWT is **deferred** — the `EventSource` API cannot send custom headers, so it would require migrating to fetch-stream or WebSocket (tracked separately).
- ✅ **E3 — Rate limiting**: `express-rate-limit` applied — register `5/min`, login `10/min` (in `routes/auth.ts`), and a global `100 req/min` per IP (in `index.ts`). Limiters are skipped only for the global limiter under test.

### Phase 5 — Observability (F1) — ✅ implemented
- ✅ **F1 — Health endpoint**: `GET /api/health` pings MongoDB (`db.admin().ping()`) and Redis (`client.ping()`) and returns `{ status: 'ok'|'degraded'|'down', services: { mongodb, redis }, uptime, timestamp }`. Status is `down` when MongoDB is unavailable, `degraded` when only Redis is down, else `ok`; returns 503 when `down`. (Crawler/opencode are external HTTP services and out of scope for a liveness ping.)
- Structured logging and metrics collection remain future work.

---

## Acceptance criteria

- ✅ A search completes with jobs shown when relevant jobs exist (Phase 0–1).
- ✅ Searches never remain stuck `running` without surfacing a failure (Phase 0).
- ✅ Re-running a similar query reuses previously discovered/crawled companies instead of re-discovering from scratch (Phase 2).
- ✅ Users can browse/resume past searches and edit their profile (Phase 3).
- ✅ Auth endpoints enforce password policy and rate limits; tokens are not leaked via query strings (Phase 4).
- ✅ Health endpoint reflects real dependency status (Phase 5).