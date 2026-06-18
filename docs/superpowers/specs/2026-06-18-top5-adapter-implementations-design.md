# Top-5 Adapter Implementations Design

**Date:** 2026-06-18
**Status:** Approved

---

## Overview

Implement five new `CareerSiteAdapter` subclasses to expand crawler coverage beyond the existing `PythonJobsAdapter` and `PersonioAdapter`. Three adapters target high-yield ATS platforms with public JSON APIs; two target HTML-scraped job boards.

Adapters chosen:

| # | Adapter | Type | Survey task |
|---|---------|------|-------------|
| 1 | GreenhouseAdapter | ATS / JSON API | #2 |
| 2 | LeverAdapter | ATS / JSON API | #3 |
| 3 | SmartRecruitersAdapter | ATS / JSON API | #5 |
| 4 | DjangoFoundationAdapter | HTML scrape | #10 |
| 5 | HeiseJobsAdapter | HTML scrape | #15 |

Workday (#4) is excluded — no public API; high reverse-engineering effort.

---

## Architecture

### Approach

One adapter file per site, following the existing `personio.py` / `pythonjobs.py` pattern. No shared ATS base class — the three ATS APIs differ in response shape, pagination style, and slug extraction enough that a shared base would be leaky.

The `_USER_AGENT` constant currently duplicated across adapter files is moved to `base.py` as a module-level constant.

### File layout

```
crawler/job_crawler/adapters/
  base.py                  # + USER_AGENT constant
  greenhouse.py            # NEW
  lever.py                 # NEW
  smartrecruiters.py       # NEW
  djangofoundation.py      # NEW
  heisejobs.py             # NEW
  registry.py              # updated: 5 new adapters added
  personio.py              # unchanged
  pythonjobs.py            # unchanged (remove local USER_AGENT)

crawler/tests/
  test_adapter_greenhouse.py      # NEW
  test_adapter_lever.py           # NEW
  test_adapter_smartrecruiters.py # NEW
  test_adapter_djangofoundation.py # NEW
  test_adapter_heisejobs.py       # NEW
  test_adapters_registry.py       # updated: 5 new URL checks
```

---

## Adapter Specifications

### GreenhouseAdapter

**`can_handle`:** `'boards.greenhouse.io' in url`

**Company slug extraction:** `urlparse(url).path.strip('/').split('/')[0]`

**API call:**
```
GET https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true
```
No auth. Returns all jobs in one response — no pagination.

**Response shape:**
```json
{
  "jobs": [
    {
      "id": 123,
      "title": "Senior Python Engineer",
      "location": {"name": "Remote"},
      "absolute_url": "https://boards.greenhouse.io/acme/jobs/123",
      "departments": [{"name": "Engineering"}],
      "content": "<p>Job description HTML...</p>"
    }
  ]
}
```

**Field mapping:**
- `title` → `title`
- `location.name` → `location`
- `absolute_url` → `url`
- `departments[0].name` (or `""`) → included in `description`
- `content` stripped of HTML tags, truncated to 500 chars → `description`
- Input URL (company board URL) → `source_url`

**Pagination:** Single response. `parse_jobs` always returns `next_token = None`.

---

### LeverAdapter

**`can_handle`:** `'jobs.lever.co' in url`

**Company slug extraction:** `urlparse(url).path.strip('/').split('/')[0]`

**API call:**
```
GET https://api.lever.co/v0/postings/{slug}?mode=json
```
No auth. Returns full list in one response.

**Response shape:**
```json
[
  {
    "id": "abc-def",
    "text": "Backend Engineer",
    "categories": {"location": "Berlin", "team": "Engineering"},
    "hostedUrl": "https://jobs.lever.co/acme/abc-def",
    "descriptionPlain": "Full job description text..."
  }
]
```

**Field mapping:**
- `text` → `title`
- `categories.location` (or `""`) → `location`
- `hostedUrl` → `url`
- `categories.team` (or `""`) → included in `description`
- `descriptionPlain[:300]` + ` | lever` → `description`
- Input URL → `source_url`

**Pagination:** Single response. `parse_jobs` always returns `next_token = None`.

---

### SmartRecruitersAdapter

**`can_handle`:** `'careers.smartrecruiters.com' in url`

**Company slug extraction:** `urlparse(url).path.strip('/').split('/')[0]`

**API call:**
```
GET https://api.smartrecruiters.com/v1/companies/{slug}/postings?limit=100&offset={offset}
```
No auth. Offset-based pagination.

**Response shape:**
```json
{
  "content": [
    {
      "id": "xyz",
      "name": "Data Engineer",
      "location": {"city": "Berlin", "country": "DE"},
      "ref": "https://careers.smartrecruiters.com/Acme/xyz",
      "department": {"label": "Engineering"}
    }
  ],
  "totalFound": 150,
  "limit": 100,
  "offset": 0
}
```

**Field mapping:**
- `name` → `title`
- `location.city` + `location.country` → `location`
- `ref` → `url`
- `department.label` → included in `description`
- Description built from title + company slug + location + department
- Input URL → `source_url`

**Pagination:** `page_token` = next offset as string. `fetch_page` passes `offset=int(page_token or 0)`. `parse_jobs` returns `str(offset + limit)` if `offset + limit < totalFound`, else `None`.

**Company slug in fetch:** The SmartRecruiters adapter must persist the slug across pages. Resolved by extracting slug in `fetch_page` from the original URL (passed through each cycle by the base `run()` loop).

---

### DjangoFoundationAdapter

**`can_handle`:** `'djangoproject.com/foundation/jobs' in url`

**URL fetched:** `https://www.djangoproject.com/foundation/jobs/` (fixed, no pagination expected).

**Method:** BeautifulSoup HTML scraping.

**Expected structure:** Django's foundation jobs page lists positions in an `<ul>` or similar; each entry has title, company/poster, and a link. Exact selectors determined during implementation by inspecting live HTML.

**Field mapping:**
- Job title from heading element → `title`
- Company/poster name → `company`
- Position link → `url`
- Location (if present in listing) → `location`, else `"Remote"`
- Description assembled from available fields + `| djangoproject.com/foundation/jobs`
- `https://www.djangoproject.com/foundation/jobs/` → `source_url`

**Pagination:** Single page. Always returns `next_token = None`.

---

### HeiseJobsAdapter

**`can_handle`:** `'jobs.heise.de' in url`

**URL fetched:** `https://jobs.heise.de/` (fixed entry point; query string or path pagination if present).

**Method:** BeautifulSoup HTML scraping on server-rendered listing.

**Expected structure:** Heise Jobs renders job cards server-side; each card contains title, company name, location, and link. Exact selectors determined during implementation.

**Field mapping:**
- Job title → `title`
- Company name → `company`
- Job link → `url`
- Location → `location`
- Description assembled from available fields + `| jobs.heise.de`
- `https://jobs.heise.de/` → `source_url`

**Pagination:** If a "next page" link exists in the HTML, extract its page token and return as `next_token`. Otherwise return `None`.

---

## Testing

Each adapter gets a dedicated test file of ~12–15 tests using `unittest.mock.patch` on `requests.get`. No real network calls.

### Per-adapter test checklist

| Test | Covers |
|------|--------|
| `test_handles_{platform}_url` | `can_handle` positive match |
| `test_does_not_handle_other_domain` | `can_handle` negative |
| `test_fetch_page_builds_correct_api_url` | slug extraction + URL construction |
| `test_fetch_page_passes_offset` (SmartRecruiters only) | pagination param |
| `test_parse_jobs_extracts_title` | field mapping |
| `test_parse_jobs_extracts_location` | field mapping |
| `test_parse_jobs_extracts_url` | field mapping |
| `test_parse_jobs_sets_source_url` | field mapping |
| `test_parse_jobs_description_meets_50_char_minimum` | description quality |
| `test_parse_jobs_returns_all_items` | count from fixture |
| `test_parse_jobs_returns_empty_list` | empty response |
| `test_parse_jobs_returns_no_next_token` (Greenhouse/Lever/Django/Heise) | pagination |
| `test_parse_jobs_returns_next_token_when_more_pages` (SmartRecruiters) | pagination |
| `test_parse_jobs_returns_no_next_token_on_last_page` (SmartRecruiters) | pagination |

### Registry test updates

`test_adapters_registry.py` gets one new test per adapter verifying `find_adapter(url)` returns the correct adapter type for a representative URL.

---

## Registry update

```python
ADAPTER_REGISTRY: list[CareerSiteAdapter] = [
    PythonJobsAdapter(),
    PersonioAdapter(),
    GreenhouseAdapter(),
    LeverAdapter(),
    SmartRecruitersAdapter(),
    DjangoFoundationAdapter(),
    HeiseJobsAdapter(),
]
```

Order is not critical for these adapters (no URL overlap), but ATS adapters are listed before HTML scrapers for clarity.
