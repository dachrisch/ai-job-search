# Crawler Site Survey — 2026-06-17

## Goal

Test the crawler against a representative set of company career pages and job boards to identify all unsupported sites. Results feed into a prioritised adapter backlog.

## Method

Direct HTTP calls to `POST /crawler/crawl-company` (port 8000) with query `"Python developer"` / `"Python Entwickler"`. Sites returning `unsupported: true` or proven false positives are candidates for new adapters.

---

## Results

### International sites

| Site | URL | unsupported | jobs | Assessment |
|---|---|---|---|---|
| python.org/jobs | https://www.python.org/jobs/ | False | 30 | ✅ PythonJobsAdapter working |
| Mozilla | https://www.mozilla.org/en-US/careers/listings/ | True | 0 | ❌ needs adapter |
| Canonical | https://canonical.com/careers/all-vacancies | True | 0 | ❌ needs adapter |
| JetBrains | https://www.jetbrains.com/careers/jobs/ | True | 0 | ❌ needs adapter |
| Elastic | https://www.elastic.co/careers/ | True | 0 | ❌ needs adapter (likely Greenhouse) |
| Shopify | https://www.shopify.com/careers | True | 0 | ❌ investigate ATS |
| GitHub | https://github.com/about/careers | True | 0 | ❌ investigate ATS |
| Stripe | https://stripe.com/jobs | True | 0 | ❌ investigate ATS |
| HashiCorp | https://www.hashicorp.com/jobs | True | 0 | ❌ investigate ATS |
| Greenhouse (example) | https://boards.greenhouse.io/stripe | True | 0 | ❌ ATS — public API available |
| Lever (example) | https://jobs.lever.co/mozilla | True | 0 | ❌ ATS — public API available |
| Workday (Stripe) | https://stripe.wd5.myworkdayjobs.com/jobs | True | 0 | ❌ ATS — no public API |
| SmartRecruiters (Docker) | https://careers.smartrecruiters.com/Docker | True | 0 | ❌ ATS — public API available |
| Django Foundation | https://www.djangoproject.com/foundation/jobs/ | True | 0 | ❌ Python-ecosystem board |
| NumFOCUS | https://numfocus.org/jobs | True | 0 | ❌ low priority |

### German / DACH sites

| Site | URL | unsupported | jobs | Assessment |
|---|---|---|---|---|
| StepStone | https://www.stepstone.de/jobs/python-entwickler | False | 1 | ❌ **false positive** (matched nav link) |
| XING Jobs | https://www.xing.com/jobs/search | True | 0 | ❌ SPA, needs adapter |
| Indeed.de | https://de.indeed.com/jobs | True | 0 | ❌ needs adapter |
| Monster.de | https://www.monster.de/jobs/suche/ | False | 1 | ❌ **false positive** (matched CV-generator CTA) |
| Jobware | https://www.jobware.de/search | True | 0 | ❌ needs adapter |
| Heise Jobs | https://jobs.heise.de/ | True | 0 | ❌ tech-relevant, needs adapter |
| Stellenanzeigen.de | https://www.stellenanzeigen.de/job-suche/python/ | True | 0 | ❌ needs adapter |
| Personio (example) | https://echobot.jobs.personio.de | True | 0 | ❌ DACH ATS — XML feed available |
| Softgarden | https://softgarden.de/jobs | True | 0 | ❌ DACH ATS |
| Haufe Umantis | https://jobs.haufe.com/ | True | 0 | ❌ DACH ATS |
| SAP Careers | https://jobs.sap.com/ | True | 0 | ❌ large enterprise, SuccessFactors ATS |
| Zalando Careers | https://jobs.zalando.com/en/ | True | 0 | ❌ needs adapter |
| Celonis Careers | https://www.celonis.com/careers/jobs/ | True | 0 | ❌ needs adapter |
| TeamViewer Careers | https://www.teamviewer.com/de/karriere/offene-stellen/ | True | 0 | ❌ needs adapter |
| DATEV Karriere | https://www.datev.de/web/de/karriere/jobs/ | True | 0 | ❌ needs adapter |
| Trivago Careers | https://company.trivago.com/open-positions/ | False | 2 | ❌ **false positive** (1 real job, duplicated) |

**Score: 1/30 genuinely working** (python.org/jobs via PythonJobsAdapter)

---

## Implementation Status (updated 2026-06-18)

| Task | Adapter | Status | Notes |
|---|---|---|---|
| #14 | PersonioAdapter | ✅ **Done** | 16 tests, live-verified. See caveat below. |
| #2 | GreenhouseAdapter | ✅ **Done** | 16 tests. PR #52. Boards-api JSON, slug guard, HTML-stripped descriptions. |
| #3 | LeverAdapter | ✅ **Done** | 15 tests. PR #52. `team` stored in JobDict. |
| #5 | SmartRecruitersAdapter | ✅ **Done** | 16 tests. PR #52. Offset pagination, 50-char description guaranteed. |
| #10 | DjangoFoundationAdapter | ✅ **Done** | 14 tests. PR #52. Selectors based on Django template conventions — verify live when jobs are posted. |
| #15 | HeiseJobsAdapter | ✅ **Done** | 16 tests. PR #52. `#jobOffers` scoped, `rel=next` pagination. |
| #4 | WorkdayAdapter | ⬜ Pending | High effort — no public API |
| #12 | StepStoneAdapter | ✅ **Done** | 18 tests. `article[data-at="job-item"]` selector, `rel=next` pagination, full description snippet extraction. |
| #13 | XINGJobsAdapter | ⬜ Pending | SPA |
| #16 | Generic spider fix | ✅ **Done** | PR feat/spider-false-positive-fixes. `url==source_url` guard + URL dedup in base spider. 5 tests. |

### Personio caveat — URL scheme migration

The `*.jobs.personio.de` subdomain scheme has been partially retired. Most known Personio customers (SumUp, N26, Celonis, Contentful, commercetools) now 307-redirect `*.jobs.personio.de` to `personio.com`. Only `personio.jobs.personio.de` (Personio's own board) still serves the XML feed at the old domain.

**Impact:** The adapter works correctly for feeds that still serve on the old scheme, and will work for `.jobs.personio.com` if that scheme is still active. The new `personio.com`-hosted job board URL structure needs investigation to determine if a public XML/JSON feed still exists and at what URL pattern.

**Next step for Personio (#14):** Investigate the current `personio.com` job board URL structure and whether the XML feed is still accessible under the new scheme before declaring this fully complete.

---

## Task Backlog

### ATS Platforms — international (one adapter → many companies)

| Task | Platform | Notes |
|---|---|---|
| #2 | **Greenhouse** (boards.greenhouse.io) | ✅ Done — PR #52 |
| #3 | **Lever** (jobs.lever.co) | ✅ Done — PR #52 |
| #5 | **SmartRecruiters** (careers.smartrecruiters.com) | ✅ Done — PR #52 |
| #4 | **Workday** (*.myworkdayjobs.com) | No public API, needs network request reverse engineering — high effort, high yield |

### ATS Platforms — German / DACH

| Task | Platform | Notes |
|---|---|---|
| #14 | **Personio** | ✅ XML adapter implemented for `*.jobs.personio.de` and `*.jobs.personio.com`. Investigation complete (2026-06-18): companies that 307-redirect to bare `personio.com` have left the hosted-board scheme; no new public API exists on personio.com. Adapter is correct as-is. |

### German job boards

| Task | Site | Notes |
|---|---|---|
| #12 | **StepStone** (stepstone.de) | ✅ Done — feat/spider-false-positive-fixes. `article[data-at="job-item"]` selector, 25 jobs/page, `rel=next` pagination. |
| #13 | **XING Jobs** (xing.com/jobs) | Major DACH professional network; SPA, needs investigation |
| #15 | **Heise Jobs** (jobs.heise.de) | ✅ Done — PR #52 |

### Python-ecosystem boards

| Task | Site | Notes |
|---|---|---|
| #10 | **Django Foundation** (djangoproject.com/foundation/jobs) | ✅ Done — PR #52. Selectors need live verification when jobs are posted. |

### Direct company pages

| Task | Companies | Notes |
|---|---|---|
| #11 | Shopify, GitHub, Stripe, HashiCorp | Investigated (2026-06-18): **Stripe** → Greenhouse `job-boards.greenhouse.io/stripe` ✅ already covered. **Shopify** → Ashby embedded SPA (no public API for their custom domain). **GitHub** → iCIMS on `www.github.careers` (no public API). **HashiCorp** → IBM-acquired, 429 blocked. |
| #6 | Mozilla | Custom SPA, no ATS API found. Not Greenhouse/Lever. Needs custom adapter or browser-based crawl. |
| #7 | Canonical | Custom board — needs investigation |
| #8 | JetBrains | Custom board — needs investigation |
| #9 | Elastic | Uses **Workday** (not Greenhouse). Same as #4 — high effort, deferred. |

### Spider quality

| Task | Issue |
|---|---|
| #16 | Generic spider false positives fixed in feat/spider-false-positive-fixes: `url==source_url` guard (Monster.de CTA) + URL dedup in base spider (Trivago duplicate). 5 tests. ✅ |

---

## Recommended Next Steps (as of 2026-06-18, updated after session 2)

Completed in PR #52: Greenhouse, Lever, SmartRecruiters, DjangoFoundation, HeiseJobs.

Completed in feat/spider-false-positive-fixes: StepStone, spider false positive fixes, Personio investigation.

Remaining backlog in priority order:

1. **XING Jobs (#13)** — Major DACH professional network; SPA, needs investigation
2. **Canonical (#7)** — Custom board, needs investigation
3. **JetBrains (#8)** — Custom board, needs investigation
4. **Ashby adapter** — Would cover Shopify, OpenAI, Cursor, Notion, etc. (2700+ companies). Ashby public API: `GET https://api.ashbyhq.com/posting-api/job-board/{slug}` — no auth needed. Need to identify slug from company's `jobs.ashbyhq.com/{slug}` URL.
5. **Workday (#4)** — high effort, no public API; defer until other boards exhausted
