# Layered Job-Source Strategy — Arbeitsagentur Tier-1 Slice — 2026-06-19

## Problem

Job discovery had no breadth backbone. The company/ATS-adapter crawl model
(`SearXNG → company career pages → per-platform adapters / generic spider`) scored
**~1/30** on real sites (see 2026-06-17 crawler survey), and the discovery layer
(branded career pages) was mismatched with what the adapters needed (raw ATS URLs).
Two competing pipelines coexisted in a 1,010-line `handlers.ts`, and the architecture
docs described neither accurately. Goal restated by the user: **find software/tech jobs
across the web, DACH-focused** — not just on a fixed set of sites.

## Solution

Pivoted to a **layered, query-based source architecture** (full design in
`docs/superpowers/specs/2026-06-19-layered-job-source-strategy-design.md`):

- **Tier 1** — free job APIs (breadth backbone). **Tier 2** — SearXNG + LLM-as-extractor
  (long tail). **Tier 3** — durable JSON ATS adapters (Greenhouse/Lever/Personio/Ashby).
- A `SourceManager` fans a `JobQuery` out to all sources in parallel, merges, and dedupes
  by normalized URL, with per-source failure isolation.
- Everything downstream of `jobs_extracted` (Claude scoring → SSE → frontend) is reused
  unchanged — new sources just persist `Job` docs and emit the existing event.

This slice delivered **Tier 1** end-to-end with one source: `ArbeitsagenturSource`
(Bundesagentur für Arbeit "Jobsuche" API — public, free, `X-API-Key: jobboerse-jobsuche`).

## Files changed

Created (`packages/api/src/sources/`):
- `types.ts` — `JobQuery` / `SourceJob` / `SourceResult` / `JobSource` interfaces.
- `arbeitsagentur-source.ts` — Tier-1 source: query → API → `SourceJob[]`.
- `manager.ts` — `SourceManager` fan-out + URL dedup + failure isolation.
- `__tests__/` — `arbeitsagentur-source.test.ts` (+ fixtures), `manager.test.ts`,
  opt-in live `arbeitsagentur-source.integration.test.ts`.

Modified:
- `packages/shared/src/types.ts` + `packages/api/src/db/models.ts` — widen
  `Job.discoveryMethod` to include `'arbeitsagentur'`.
- `packages/api/src/events/handlers.ts` — `search_started` runs `SourceManager` additively,
  stores jobs, emits `jobs_extracted`; fail-soft when no companies but API jobs exist
  (emits `search_complete`).
- `packages/api/src/job-sources/__tests__/crawler-source.test.ts` and
  `packages/api/tests/handlers.test.ts` — hardened axios/SourceManager mocks for
  `isolate:false` (see Known issues).

## Verification

- Unit: `cd packages/api && npm test -- --run src/sources` → 8 passed (+1 opt-in skipped).
- Live contract: `RUN_INTEGRATION_TESTS=true npm test -- --run …integration.test.ts` →
  passes against the real Arbeitsagentur API.
- CI-equivalent: `CI=true npm test -- --run` → 132 passed, 0 failures.
- Full local suite: 148 passed; only `discovery-integration.test.ts` fails (needs live
  servyy-test Mongo — environmental, fails on master too).

## Deployment result

Shipped in **v0.6.0** (release-please). CI green; tag pipeline published
`dachrisch/job-search-{api,crawler,frontend}:latest` to Docker Hub. Deployed on
`servyy-test` (`/home/cda/servyy-container/job-search`) via `docker compose pull && up -d`;
all containers healthy.

**End-to-end retest** (deployed instance, query "Python Entwickler Berlin") returned real
DACH jobs with `discoveryMethod: "arbeitsagentur"` (e.g. BWI GmbH/München, iSK/Berlin,
SIX Offene Systeme/Stuttgart, snafu GmbH/Berlin).

## Success criteria — met

- ✅ Real DACH software jobs returned across the web (not a fixed site list).
- ✅ Additive: existing scoring/SSE/frontend pipeline untouched; old paths still present.
- ✅ Durable source (JSON API, no selector rot).

## Known issues

- **`discoveryMethod` filter / scoring**: scoring needs a valid Claude token; with an
  invalid token it falls back to default scores (jobs still persist).
- **Local `tsc`/build OOM** (TypeScript 6.0.3) — verify via Vitest; CI unaffected. Pin to
  5.x eventually (deferred).
- **`isolate:false` mock fragility** — order-dependent axios/module mock bleed; fixed in
  the touched tests via the explicit-factory + `resetModules` + dynamic-import pattern.
- `discovery-integration.test.ts` points at Mongo `10.185.182.250` (unreachable here).

## Future enhancements

- Tier 3: rehome JSON ATS adapters behind `JobSource`; add **Ashby** (2700+ companies).
- Tier 2: SearXNG + LLM-as-extractor.
- Forward `location`/`radius` from the query into sources (currently nationwide default).
- Add Adzuna as a second Tier-1 source; retire legacy Pipeline B + brittle HTML scrapers.
