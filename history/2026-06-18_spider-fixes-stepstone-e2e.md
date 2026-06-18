# Crawler Session — 2026-06-18

## What Was Delivered

### PR #54 — `feat/spider-false-positive-fixes`

Three commits:

| Commit | Change | Tests |
|--------|--------|-------|
| `fix(crawler)` | Spider false positive fixes (`#16`) | 5 new |
| `feat(crawler)` | StepStoneAdapter (`#12`) | 18 new |
| `docs(survey)` | Survey status update | — |

**Total: 150 tests passing (was 132 before this session).**

---

## Spider False Positive Fixes (`#16`)

Two regression cases from the 2026-06-17 survey:

### Monster.de — CTA matched as a job

Root cause: `GenericCareerPageSpider.parse_job_item()` fell back to `url = response.url`
when no job-specific link was found in a container. A CTA element ("Upload your CV")
had a valid title and company but its href resolved to the current page URL.

Fix: Return `None` from `parse_job_item` when `job_url` is empty or equals `response.url`.

### Trivago — one real job duplicated

Root cause: The same job container appeared twice in the HTML (e.g. sticky header + list body).
`base_spider.py parse()` had no deduplication.

Fix: Track `seen_urls: set[str]` per page in `BaseJobSpider.parse()`. Skip any container
whose URL was already emitted.

Files changed:
- `crawler/job_crawler/spiders/generic_career_spider.py`
- `crawler/job_crawler/spiders/base_spider.py`
- `crawler/tests/test_spider_false_positives.py` (5 tests)

---

## StepStoneAdapter (`#12`)

StepStone uses stable `data-at` attributes for its job cards — much more reliable
than CSS class names which are auto-generated (Emotion/JSX hash classes like `res-4cwuay`).

Selectors used:
- Container: `article[data-at="job-item"]`
- Title + URL: `a[data-at="job-item-title"]`
- Company: `[data-at="job-item-company-name"]`
- Location: `[data-at="job-item-location"]`
- Description snippet: `[data-at="jobcard-content"]`
- Pagination: `link[rel="next"]` → full next-page URL as token

Returns 25 jobs per page, `rel=next` drives pagination.

Files:
- `crawler/job_crawler/adapters/stepstone.py`
- `crawler/job_crawler/adapters/registry.py`
- `crawler/tests/test_adapter_stepstone.py` (18 tests)

---

## Survey Investigations Completed

### Personio (#14) — URL scheme migration

Finding: `*.jobs.personio.de` and `*.jobs.personio.com` both redirect to bare `personio.com`
for companies that have left Personio's hosted board. The `personio.com` domain is a Next.js/
Vercel SPA with no public job board API. The adapter is correct as-is; companies that 307
to `personio.com` are simply unsupported (they've exited the hosted-board scheme).

No code changes needed. Status: closed.

### Company ATS investigation (#11) — Shopify, GitHub, Stripe, HashiCorp

| Company | ATS | Status |
|---------|-----|--------|
| Stripe | Greenhouse (`job-boards.greenhouse.io/stripe`) | ✅ Already covered |
| Shopify | Ashby (embedded SPA on `www.shopify.com/careers`) | Not covered; no public API on their custom domain |
| GitHub | iCIMS (`www.github.careers`) | Not covered; iCIMS has no public API |
| HashiCorp | IBM-acquired; 429 rate-limited | Could not determine |

### Other company pages

| Company | Finding |
|---------|---------|
| Mozilla (#6) | Custom React SPA; no ATS API found |
| Elastic (#9) | Uses Workday (not Greenhouse as assumed) |

### Ashby ATS — high-value future target

Ashby has a public unauthenticated API: `GET https://api.ashbyhq.com/posting-api/job-board/{slug}`

The slug is the path segment at `jobs.ashbyhq.com/{slug}`. Ashby hosts 2700+ companies
including OpenAI, Notion, Cursor, Snowflake. No auth required. Implementation would be
similar to GreenhouseAdapter (JSON, single endpoint, no pagination). **High ROI next task.**

---

## E2E Test Results

Tested via `POST /crawler/crawl-company` against live URLs:

| Adapter | Test URL | Result |
|---------|----------|--------|
| GreenhouseAdapter | `boards.greenhouse.io/anthropic` | ✅ 369 jobs |
| PythonJobsAdapter | `www.python.org/jobs/` | ✅ 30 jobs |
| PersonioAdapter | `personio.jobs.personio.de` | ✅ 1 job |
| StepStoneAdapter | `www.stepstone.de/jobs/python-entwickler` | ⚠️ Rate-limited on rapid test; 25 jobs confirmed in isolated parse |
| LeverAdapter | `jobs.lever.co/openai` → 404 | ❌ OpenAI moved ATS |
| SmartRecruitersAdapter | `careers.smartrecruiters.com/Docker` | ❌ Docker has 0 active listings |
| HeiseJobsAdapter | `jobs.heise.de/` | ❌ Selector rot — site redesigned |
| DjangoFoundationAdapter | not tested | (board rarely has open positions) |

### StepStone rate-limiting

StepStone enforces request throttling. When the adapter is called in rapid succession
(e.g. integration test immediately after direct parse), the second request times out at 30s.
In production, this won't be an issue since crawls run at natural intervals.

Mitigation: adapter timeout is already 30s. No change needed for now.

### HeiseJobs selector rot — ACTION REQUIRED

HeiseJobs redesigned their site. The `ul#jobOffers` container is gone. The homepage now
shows only 4 sponsored slots; the main job list is no longer accessible via simple HTML pagination.

- Previous: `ul#jobOffers > li` → job list with `a[href*="/job?id="]` links
- Current: homepage only has 4 `li` elements inside a `ul` with JSX class names

Impact: HeiseJobsAdapter returns 0 jobs in production.
Next step: investigate new URL structure (`/data-science/jobs/python-developer`-style pages or
API endpoint) and update the adapter. This is a regression against PR #52.

---

## Next Priorities (updated)

1. **Fix HeiseJobs adapter** (regression — urgent) — investigate new site structure
2. **AshbyAdapter** — public API, covers 2700+ companies; high ROI
3. **XING Jobs (#13)** — SPA, needs investigation
4. **Canonical (#7) / JetBrains (#8)** — custom boards, needs investigation
5. **Workday (#4)** — no public API; deferred
