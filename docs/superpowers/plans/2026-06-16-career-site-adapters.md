# Career Site Custom Adapters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Playwright-based live SPA-discovery fallback with a registry of hand-built `CareerSiteAdapter` modules per ATS platform, tag companies the crawler can't extract jobs from as `unsupported`, and remove the chromium/firefox-esr Docker bloat plus the LLM-guessed endpoint-config machinery.

**Architecture:** Python crawler gains a `job_crawler/adapters/` package (base class with `can_handle`/`authenticate`/`fetch_page`/`parse_jobs` hooks + an ordered registry) tried before the generic Scrapy spider. A new `unsupported: bool` flag replaces `needs_discovery`/`network_capture` on `CompanyCrawlResult` and flows through to a new `Company.status = 'unsupported'` value in the Node.js API. All Playwright and per-company LLM-discovery code is deleted.

**Tech Stack:** Python (pydantic, pytest, Scrapy), TypeScript (Mongoose, Vitest)

**Reference spec:** `docs/superpowers/specs/2026-06-16-career-site-adapters-design.md`

**Note on file paths:** The spec mentions `packages/api/src/models/company.ts` for the `Company` status enum, but that file is dead code — nothing imports it (verified via `grep -rln "models/company"`). The actually-used schema lives in `packages/api/src/db/models.ts` (imported by `handlers.ts` and everywhere else). This plan edits the real file; `models/company.ts` is left untouched as it's out of scope for this change.

---

## File Structure

**New (crawler):**
- `crawler/job_crawler/adapters/__init__.py` — empty package marker
- `crawler/job_crawler/adapters/base.py` — `CareerSiteAdapter` abstract class + `run()` orchestrator
- `crawler/job_crawler/adapters/registry.py` — `ADAPTER_REGISTRY` list + `find_adapter(url)`
- `crawler/tests/test_adapters_base.py`
- `crawler/tests/test_adapters_registry.py`
- `crawler/tests/test_cli_adapter_dispatch.py`

**Modified (crawler):**
- `crawler/models.py` — remove `CapturedRequest`, replace `network_capture`/`needs_discovery` with `unsupported` on `CompanyCrawlResult`
- `crawler/tests/test_models.py` — update for the above
- `crawler/cli.py` — add `_try_adapter()`, wire into `_run_company_crawl_worker`, drop the Playwright fallback branch and unused `asyncio` import
- `crawler/config.py` — remove `CHROMIUM_EXECUTABLE_PATH`
- `crawler/requirements.txt` — remove `playwright`, `pytest-asyncio`
- `crawler/Dockerfile` — remove chromium/firefox-esr install

**Deleted (crawler):**
- `crawler/job_crawler/network_interceptor.py`
- `crawler/tests/test_network_interceptor.py`

**Modified (API):**
- `packages/shared/src/types.ts` — `Company.status` gains `'unsupported'`, remove `discoveredApi` field and `DiscoveredApiConfig` interface
- `packages/api/src/db/models.ts` — remove `discoveredApiSchema`, update `companySchema.status` enum, remove `discoveredApi` field
- `packages/api/src/events/handlers.ts` — remove discovery imports/branches from `crawl_company`, handle `unsupported` in `company_crawled`
- `packages/api/src/events/__tests__/crawl-company-handler.test.ts` — rewritten for the simplified flow

**Deleted (API):**
- `packages/api/src/discovery/api-discoverer.ts` + `packages/api/src/discovery/__tests__/api-discoverer.test.ts`
- `packages/api/src/discovery/direct-fetcher.ts` + `packages/api/src/discovery/__tests__/direct-fetcher.test.ts`
- `packages/api/src/discovery/` (now-empty directory)

---

## Task 1: `CompanyCrawlResult.unsupported` field

**Files:**
- Modify: `crawler/models.py`
- Modify: `crawler/tests/test_models.py`

- [ ] **Step 1: Write the failing test**

Replace the contents of `crawler/tests/test_models.py` with:

```python
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from models import CompanyCrawlResult


def test_company_crawl_result_defaults():
    result = CompanyCrawlResult(search_id='s1', company_id='c1')
    assert result.jobs == []
    assert result.unsupported is False


def test_company_crawl_result_unsupported_true():
    result = CompanyCrawlResult(search_id='s1', company_id='c1', unsupported=True)
    assert result.unsupported is True
    d = result.model_dump(by_alias=True)
    assert d['unsupported'] is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd crawler && python3 -m pytest tests/test_models.py -v`
Expected: FAIL — `CompanyCrawlResult` has no field `unsupported` (pydantic raises a validation/unexpected-keyword error on the second test; the first test passes accidentally since `unsupported` isn't asserted to exist yet — both will fail once you check `result.unsupported`, since the attribute doesn't exist: `AttributeError: 'CompanyCrawlResult' object has no attribute 'unsupported'`).

- [ ] **Step 3: Remove `CapturedRequest` and update `CompanyCrawlResult` in `crawler/models.py`**

Delete the entire `CapturedRequest` class block (currently lines 61-73, including its section header comment):

```python
# ---------------------------------------------------------------------------
# CapturedRequest — one XHR/fetch call intercepted by Playwright
# ---------------------------------------------------------------------------

class CapturedRequest(BaseModel):
    """A JSON API call intercepted by the Playwright network interceptor."""

    model_config = _CAMEL_CONFIG

    url: str = Field(description="Full URL of the intercepted request")
    method: str = Field(description="HTTP method: GET or POST")
    response_body: str = Field(description="JSON response body truncated to 3KB")
    response_status: int = Field(description="HTTP response status code")
```

Replace the `CompanyCrawlResult` class with:

```python
class CompanyCrawlResult(BaseModel):
    """Result from crawling a single company career page."""

    model_config = _CAMEL_CONFIG

    search_id: str
    company_id: str
    jobs: list[JobData] = Field(default_factory=list)
    discovered_companies: list[dict[str, Any]] = Field(
        default_factory=list,
        description="Other companies mentioned on this company's page"
    )
    errors: list[dict[str, Any]] = Field(default_factory=list)
    unsupported: bool = Field(
        default=False,
        description="True when the crawl completed but no jobs could be extracted (no adapter matched and the generic spider found nothing)"
    )
    timestamp: str = Field(default_factory=SiteResult.utc_now_iso)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd crawler && python3 -m pytest tests/test_models.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add crawler/models.py crawler/tests/test_models.py
git commit -m "$(cat <<'EOF'
refactor(crawler): replace needs_discovery/network_capture with unsupported flag

Drops the Playwright-specific CapturedRequest model and the
needs_discovery/network_capture fields on CompanyCrawlResult in favor
of a single unsupported flag, ahead of removing the live SPA-discovery
fallback entirely.
EOF
)"
```

---

## Task 2: `CareerSiteAdapter` base class

**Files:**
- Create: `crawler/job_crawler/adapters/__init__.py`
- Create: `crawler/job_crawler/adapters/base.py`
- Test: `crawler/tests/test_adapters_base.py`

- [ ] **Step 1: Write the failing test**

Create `crawler/tests/test_adapters_base.py`:

```python
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import pytest
from job_crawler.adapters.base import CareerSiteAdapter


class _StubAdapter(CareerSiteAdapter):
    """Minimal adapter for exercising the base run() orchestrator."""

    def __init__(self, pages):
        self._pages = pages
        self.fetch_calls = []

    def can_handle(self, url):
        return True

    def fetch_page(self, url, keywords, auth_context, page_token):
        self.fetch_calls.append(page_token)
        return self._pages[len(self.fetch_calls) - 1]

    def parse_jobs(self, raw_page):
        return raw_page['jobs'], raw_page.get('next_token')


def test_run_single_page_returns_jobs():
    adapter = _StubAdapter(pages=[{'jobs': [{'title': 'Engineer'}], 'next_token': None}])
    jobs = adapter.run('https://example.com/careers', 'engineer')
    assert jobs == [{'title': 'Engineer'}]
    assert adapter.fetch_calls == [None]


def test_run_follows_pagination_token():
    adapter = _StubAdapter(pages=[
        {'jobs': [{'title': 'Engineer 1'}], 'next_token': 'page2'},
        {'jobs': [{'title': 'Engineer 2'}], 'next_token': None},
    ])
    jobs = adapter.run('https://example.com/careers', 'engineer')
    assert jobs == [{'title': 'Engineer 1'}, {'title': 'Engineer 2'}]
    assert adapter.fetch_calls == [None, 'page2']


def test_run_stops_after_max_pages():
    pages = [{'jobs': [{'title': f'Engineer {i}'}], 'next_token': 'more'} for i in range(20)]
    adapter = _StubAdapter(pages=pages)
    jobs = adapter.run('https://example.com/careers', 'engineer')
    assert len(jobs) == 10
    assert len(adapter.fetch_calls) == 10


def test_authenticate_defaults_to_empty_context():
    adapter = _StubAdapter(pages=[{'jobs': [], 'next_token': None}])
    assert adapter.authenticate('https://example.com/careers') == {}


def test_cannot_instantiate_without_required_hooks():
    with pytest.raises(TypeError):
        CareerSiteAdapter()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd crawler && python3 -m pytest tests/test_adapters_base.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'job_crawler.adapters'`

- [ ] **Step 3: Implement the base class**

Create `crawler/job_crawler/adapters/__init__.py` (empty file).

Create `crawler/job_crawler/adapters/base.py`:

```python
"""
Base class for career-site adapters.

Adapters implement four lifecycle hooks so the crawler can fetch job
listings directly from a known ATS platform's API instead of relying on
the generic Scrapy spider. See registry.py for how adapters are matched
to a URL, and cli.py's _try_adapter() for how the crawler invokes them.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

AuthContext = dict[str, Any]
RawPage = dict[str, Any]
JobDict = dict[str, Any]

MAX_PAGES = 10


class CareerSiteAdapter(ABC):
    """Fetches job listings from a specific ATS platform's API."""

    @abstractmethod
    def can_handle(self, url: str) -> bool:
        """Return True if this adapter knows how to fetch jobs from url."""
        raise NotImplementedError

    def authenticate(self, url: str) -> AuthContext:
        """Acquire any session/token/cookie needed before fetching. Default: none."""
        return {}

    @abstractmethod
    def fetch_page(
        self, url: str, keywords: str, auth_context: AuthContext, page_token: str | None
    ) -> RawPage:
        """Perform one HTTP request and return the raw response."""
        raise NotImplementedError

    @abstractmethod
    def parse_jobs(self, raw_page: RawPage) -> tuple[list[JobDict], str | None]:
        """Extract job dicts and an optional next-page token from one raw page."""
        raise NotImplementedError

    def run(self, url: str, keywords: str) -> list[JobDict]:
        """Drive authenticate -> fetch_page/parse_jobs loop, capped at MAX_PAGES."""
        auth_context = self.authenticate(url)
        jobs: list[JobDict] = []
        page_token: str | None = None

        for _ in range(MAX_PAGES):
            raw_page = self.fetch_page(url, keywords, auth_context, page_token)
            page_jobs, page_token = self.parse_jobs(raw_page)
            jobs.extend(page_jobs)
            if not page_token:
                break

        return jobs
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd crawler && python3 -m pytest tests/test_adapters_base.py -v`
Expected: PASS (5 passed)

- [ ] **Step 5: Commit**

```bash
git add crawler/job_crawler/adapters/__init__.py crawler/job_crawler/adapters/base.py crawler/tests/test_adapters_base.py
git commit -m "$(cat <<'EOF'
feat(crawler): add CareerSiteAdapter base class

Defines the four-hook adapter interface (can_handle, authenticate,
fetch_page, parse_jobs) and a run() orchestrator that drives pagination
up to a fixed page cap. No concrete adapters yet — those come from the
per-platform investigation workflow described in the design spec.
EOF
)"
```

---

## Task 3: Adapter registry

**Files:**
- Create: `crawler/job_crawler/adapters/registry.py`
- Test: `crawler/tests/test_adapters_registry.py`

- [ ] **Step 1: Write the failing test**

Create `crawler/tests/test_adapters_registry.py`:

```python
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from job_crawler.adapters.base import CareerSiteAdapter
from job_crawler.adapters import registry


class _WorkdayStub(CareerSiteAdapter):
    def can_handle(self, url):
        return 'myworkdayjobs.com' in url

    def fetch_page(self, url, keywords, auth_context, page_token):
        return {}

    def parse_jobs(self, raw_page):
        return [], None


class _GreenhouseStub(CareerSiteAdapter):
    def can_handle(self, url):
        return 'greenhouse.io' in url

    def fetch_page(self, url, keywords, auth_context, page_token):
        return {}

    def parse_jobs(self, raw_page):
        return [], None


def test_find_adapter_returns_matching_adapter(monkeypatch):
    workday = _WorkdayStub()
    greenhouse = _GreenhouseStub()
    monkeypatch.setattr(registry, 'ADAPTER_REGISTRY', [workday, greenhouse])

    assert registry.find_adapter('https://ibm.wd3.myworkdayjobs.com/jobs') is workday
    assert registry.find_adapter('https://boards.greenhouse.io/stripe') is greenhouse


def test_find_adapter_returns_none_when_no_match(monkeypatch):
    monkeypatch.setattr(registry, 'ADAPTER_REGISTRY', [_WorkdayStub()])

    assert registry.find_adapter('https://example.com/careers') is None


def test_find_adapter_returns_first_match_in_order(monkeypatch):
    workday = _WorkdayStub()
    catch_all = _GreenhouseStub()
    catch_all.can_handle = lambda url: True
    monkeypatch.setattr(registry, 'ADAPTER_REGISTRY', [workday, catch_all])

    assert registry.find_adapter('https://example.com/careers') is catch_all
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd crawler && python3 -m pytest tests/test_adapters_registry.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'job_crawler.adapters.registry'`

- [ ] **Step 3: Implement the registry**

Create `crawler/job_crawler/adapters/registry.py`:

```python
"""Registry of career-site adapters, matched to a URL in order."""

from __future__ import annotations

from job_crawler.adapters.base import CareerSiteAdapter

ADAPTER_REGISTRY: list[CareerSiteAdapter] = []


def find_adapter(url: str) -> CareerSiteAdapter | None:
    """Return the first registered adapter whose can_handle(url) is True."""
    for adapter in ADAPTER_REGISTRY:
        if adapter.can_handle(url):
            return adapter
    return None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd crawler && python3 -m pytest tests/test_adapters_registry.py -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add crawler/job_crawler/adapters/registry.py crawler/tests/test_adapters_registry.py
git commit -m "feat(crawler): add adapter registry with ordered URL matching"
```

---

## Task 4: `_try_adapter()` dispatch helper in `cli.py`

**Files:**
- Modify: `crawler/cli.py`
- Test: `crawler/tests/test_cli_adapter_dispatch.py`

- [ ] **Step 1: Write the failing test**

Create `crawler/tests/test_cli_adapter_dispatch.py`:

```python
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from unittest.mock import patch

from cli import _try_adapter
from job_crawler.adapters.base import CareerSiteAdapter

VALID_JOB = {
    'title': 'Senior Backend Engineer',
    'company': 'Acme',
    'description': 'A' * 60,
    'url': 'https://acme.com/jobs/1',
    'location': 'Remote',
    'source_url': 'https://acme.com/careers',
}


class _MatchingAdapter(CareerSiteAdapter):
    def __init__(self, jobs=None, raises=False):
        self._jobs = jobs or []
        self._raises = raises

    def can_handle(self, url):
        return True

    def fetch_page(self, url, keywords, auth_context, page_token):
        return {}

    def parse_jobs(self, raw_page):
        return self._jobs, None

    def run(self, url, keywords):
        if self._raises:
            raise RuntimeError('boom')
        return self._jobs


def test_returns_none_when_no_adapter_matches():
    with patch('cli.find_adapter', return_value=None):
        assert _try_adapter('https://example.com/careers', 'engineer') is None


def test_returns_validated_jobs_when_adapter_matches():
    adapter = _MatchingAdapter(jobs=[VALID_JOB])
    with patch('cli.find_adapter', return_value=adapter):
        result = _try_adapter('https://acme.com/careers', 'engineer')
    assert result is not None
    assert len(result) == 1
    assert result[0]['title'] == 'Senior Backend Engineer'


def test_returns_none_when_adapter_raises():
    adapter = _MatchingAdapter(raises=True)
    with patch('cli.find_adapter', return_value=adapter):
        assert _try_adapter('https://acme.com/careers', 'engineer') is None


def test_returns_none_when_adapter_jobs_fail_validation():
    invalid_job = {**VALID_JOB, 'title': 'short'}
    adapter = _MatchingAdapter(jobs=[invalid_job])
    with patch('cli.find_adapter', return_value=adapter):
        assert _try_adapter('https://acme.com/careers', 'engineer') is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd crawler && python3 -m pytest tests/test_cli_adapter_dispatch.py -v`
Expected: FAIL with `ImportError: cannot import name '_try_adapter' from 'cli'`

- [ ] **Step 3: Add `_try_adapter()` to `crawler/cli.py`**

Add this import alongside the existing top-of-file imports (after `from models import CrawlerConfig, SiteResult, scrapy_item_to_job_data` on line 13):

```python
from job_crawler.adapters.registry import find_adapter
```

Add this function after `_resolve_spider` (after line 49, before the `collected_jobs` global on line 52):

```python
def _try_adapter(url: str, keywords: str) -> list[dict] | None:
    """
    Attempt to fetch jobs via a registered adapter for url.

    Returns a list of validated, camelCase job dicts if an adapter matched
    and produced at least one valid job. Returns None if no adapter matched,
    the adapter raised, or none of its jobs passed JobData validation — in
    all of these cases the caller should fall back to the generic spider.
    """
    adapter = find_adapter(url)
    if adapter is None:
        return None

    try:
        raw_jobs = adapter.run(url, keywords)
    except Exception as exc:
        log.warning(
            "Adapter failed; falling back to generic spider",
            extra={"url": url, "adapter": type(adapter).__name__, "error": str(exc)},
        )
        return None

    validated = [job for job in (scrapy_item_to_job_data(raw) for raw in raw_jobs) if job is not None]
    if not validated:
        return None

    return [job.model_dump(by_alias=True) for job in validated]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd crawler && python3 -m pytest tests/test_cli_adapter_dispatch.py -v`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**

```bash
git add crawler/cli.py crawler/tests/test_cli_adapter_dispatch.py
git commit -m "feat(crawler): add _try_adapter dispatch helper"
```

---

## Task 5: Wire adapter dispatch into the company crawl worker, remove Playwright fallback

**Files:**
- Modify: `crawler/cli.py`

- [ ] **Step 1: Replace `_run_company_crawl_worker`**

This function isn't independently unit-testable (it runs Scrapy/Twisted in a subprocess — the existing codebase has no test for it either). Verification for this step is the full test suite run in Step 2.

Replace the entire `_run_company_crawl_worker` function (currently lines 151-219) with:

```python
def _run_company_crawl_worker(
    queue: multiprocessing.Queue,
    search_id: str,
    company_id: str,
    url: str,
    company_name: str,
    keywords: str,
) -> None:
    """
    Worker that runs a single company crawl in a fresh subprocess so the
    Twisted reactor starts clean.
    """
    global collected_jobs
    collected_jobs = []

    adapter_jobs = _try_adapter(url, keywords)
    if adapter_jobs is not None:
        queue.put({
            "search_id": search_id,
            "company_id": company_id,
            "jobs": adapter_jobs,
            "unsupported": False,
            "discovered_companies": [],
            "errors": [],
            "timestamp": SiteResult.utc_now_iso(),
        })
        return

    from scrapy.crawler import CrawlerProcess
    from scrapy.utils.project import get_project_settings
    from job_crawler.spiders.generic_career_spider import GenericCareerPageSpider
    import config as _cfg

    settings = get_project_settings()
    settings.set('ITEM_PIPELINES', {'cli.JobCollectorPipeline': 300})
    settings.set('ROBOTSTXT_OBEY', True)
    settings.set('CONCURRENT_REQUESTS', 1)
    settings.set('DOWNLOAD_DELAY', 1)
    settings.set('USER_AGENT', _cfg.DEFAULT_USER_AGENT)
    settings.set('LOG_LEVEL', 'INFO')
    settings.set('DOWNLOAD_TIMEOUT', 30)

    process = CrawlerProcess(settings)
    process.crawl(GenericCareerPageSpider, urls=[url], keywords=keywords, company_name=company_name)

    try:
        process.start()
    except Exception:
        pass

    validated_jobs = []
    for raw_item in collected_jobs:
        job = scrapy_item_to_job_data(raw_item)
        if job is not None:
            validated_jobs.append(job)

    queue.put({
        "search_id": search_id,
        "company_id": company_id,
        "jobs": [j.model_dump(by_alias=True) for j in validated_jobs],
        "unsupported": len(validated_jobs) == 0,
        "discovered_companies": [],
        "errors": [],
        "timestamp": SiteResult.utc_now_iso(),
    })
```

Remove the now-unused `import asyncio` from the top of the file (line 2).

- [ ] **Step 2: Run the full crawler test suite**

Run: `cd crawler && python3 -m pytest tests/ -q`
Expected: All tests pass (no `test_network_interceptor.py` failures yet since it's deleted in Task 6 — if it still exists at this point, it will still pass since `network_interceptor.py` itself isn't touched until Task 6; if you've already done Task 6 first, skip ahead, otherwise this is fine to run now or after Task 6).

- [ ] **Step 3: Commit**

```bash
git add crawler/cli.py
git commit -m "$(cat <<'EOF'
feat(crawler): dispatch to adapter registry before generic spider

Company crawl worker now tries _try_adapter() first; only falls back
to the Scrapy generic spider when no adapter matches. Sets unsupported
when the generic spider also extracts nothing, replacing the old
Playwright/network-capture path.
EOF
)"
```

---

## Task 6: Remove Playwright entirely

**Files:**
- Delete: `crawler/job_crawler/network_interceptor.py`
- Delete: `crawler/tests/test_network_interceptor.py`
- Modify: `crawler/config.py`
- Modify: `crawler/requirements.txt`
- Modify: `crawler/Dockerfile`

- [ ] **Step 1: Delete the interceptor and its test**

```bash
rm crawler/job_crawler/network_interceptor.py
rm crawler/tests/test_network_interceptor.py
```

- [ ] **Step 2: Remove `CHROMIUM_EXECUTABLE_PATH` from `crawler/config.py`**

Delete this block (currently lines 104-111):

```python
# ---------------------------------------------------------------------------
# Playwright (SPA network capture)
# ---------------------------------------------------------------------------

# Path to a system Chromium/Chrome binary. Playwright's bundled browser
# download doesn't support every OS; set this to reuse an already-installed
# browser (e.g. /usr/bin/google-chrome) instead of Playwright's own download.
CHROMIUM_EXECUTABLE_PATH: str | None = os.getenv("CHROMIUM_EXECUTABLE_PATH") or None
```

- [ ] **Step 3: Remove `playwright` and `pytest-asyncio` from `crawler/requirements.txt`**

Edit `crawler/requirements.txt` to remove these two lines and the now-stale comment above `playwright`:

```
# Browser automation for SPA career page rendering
playwright==1.60.0
```

and:

```
pytest-asyncio==0.24.0
```

The resulting file should read:

```
# Web scraping
scrapy==2.16.0
beautifulsoup4==4.15.0

# HTTP server
flask==3.1.3

# Data validation
pydantic==2.13.4

# Redis integration (for future event-driven mode)
redis==8.0.0

# HTTP client
requests==2.34.2

# Environment variable management
python-dotenv==1.2.2

# Structured JSON logging
python-json-logger==4.1.0

# Testing
pytest==8.3.5
```

- [ ] **Step 4: Remove chromium/firefox-esr from `crawler/Dockerfile`**

Replace the full `crawler/Dockerfile` with:

```dockerfile
FROM python:3.14-slim

WORKDIR /app

COPY crawler/requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

COPY crawler/ .

EXPOSE 8000

HEALTHCHECK --interval=10s --timeout=5s --retries=5 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

CMD ["python", "server.py"]
```

- [ ] **Step 5: Run the full crawler test suite**

Run: `cd crawler && python3 -m pytest tests/ -q`
Expected: All tests pass, with the same or fewer total tests than before this task (the deleted `test_network_interceptor.py` tests are gone).

- [ ] **Step 6: Commit**

```bash
git add -A crawler/
git commit -m "$(cat <<'EOF'
chore(crawler): remove Playwright and its Docker dependencies

Removes the network_interceptor module, the CHROMIUM_EXECUTABLE_PATH
config, the playwright/pytest-asyncio pip dependencies, and the
chromium/firefox-esr apt packages from the crawler image. The adapter
registry (added in prior commits) replaces this functionality.
EOF
)"
```

---

## Task 7: `Company.status` gains `'unsupported'`; remove `DiscoveredApiConfig`

**Files:**
- Modify: `packages/shared/src/types.ts`

- [ ] **Step 1: Edit `packages/shared/src/types.ts`**

Remove the `DiscoveredApiConfig` interface (currently lines 32-44):

```typescript
export interface DiscoveredApiConfig {
  endpoint: string
  method: 'GET' | 'POST'
  paramTemplate: Record<string, any>
  fieldMapping: {
    title: string
    url: string
    location: string
    description: string
  }
  platform?: string
  discoveredAt: Date
}

```

Replace the `Company` interface (currently lines 46-61) with:

```typescript
export interface Company {
  _id: string
  url: string
  name: string
  location?: string
  industry?: string
  searchQuery: string
  discoveredFrom: 'searxng' | 'manual'
  confidence?: 'high' | 'medium' | 'low'
  status: 'pending_crawl' | 'crawling' | 'crawled' | 'failed' | 'unsupported'
  crawlAttempts: number
  lastCrawlTime?: Date
  createdAt: Date
  updatedAt: Date
}
```

- [ ] **Step 2: Build the shared package**

Run: `cd /home/cda/dev/job-search && npm run build --workspace=@job-search/shared`
Expected: Build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/types.ts
git commit -m "feat(shared): add unsupported Company status, remove DiscoveredApiConfig"
```

---

## Task 8: Update Mongoose `Company` schema

**Files:**
- Modify: `packages/api/src/db/models.ts`

- [ ] **Step 1: Remove `discoveredApiSchema` and update `companySchema`**

Delete the `discoveredApiSchema` block (currently lines 48-60):

```typescript
const discoveredApiSchema = new Schema({
  endpoint: { type: String, required: true },
  method: { type: String, enum: ['GET', 'POST'], required: true },
  paramTemplate: { type: Schema.Types.Mixed, required: true },
  fieldMapping: {
    title: { type: String, required: true },
    url: { type: String, required: true },
    location: { type: String, required: true },
    description: { type: String, required: true },
  },
  platform: { type: String },
  discoveredAt: { type: Date, required: true },
}, { _id: false })

```

Replace the `companySchema` definition (currently lines 62-82) with:

```typescript
const companySchema = new Schema<Company>(
  {
    url: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    location: { type: String },
    industry: { type: String },
    searchQuery: { type: String, required: true, index: true },
    discoveredFrom: { type: String, required: true },
    status: {
      type: String,
      enum: ['pending_crawl', 'crawling', 'crawled', 'failed', 'unsupported'],
      required: true,
      index: true,
      default: 'pending_crawl',
    },
    crawlAttempts: { type: Number, default: 0 },
    lastCrawlTime: { type: Date },
  },
  { timestamps: true }
)
```

- [ ] **Step 2: Build the API package**

Run: `cd /home/cda/dev/job-search && npm run build --workspace=@job-search/api`
Expected: This will currently FAIL — `handlers.ts` still imports `discoverJobsApi`/`fetchFromDiscoveredApi` and reads `company.discoveredApi`, which no longer exists on the `Company` type. That's expected; Task 9 fixes it. Confirm the failure is specifically about `discoveredApi`/`discovery/api-discoverer.js`/`discovery/direct-fetcher.js`, not something else.

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/db/models.ts
git commit -m "feat(api): add unsupported to Company status enum, drop discoveredApi schema"
```

---

## Task 9: Remove `discovery/` module

**Files:**
- Delete: `packages/api/src/discovery/api-discoverer.ts`
- Delete: `packages/api/src/discovery/__tests__/api-discoverer.test.ts`
- Delete: `packages/api/src/discovery/direct-fetcher.ts`
- Delete: `packages/api/src/discovery/__tests__/direct-fetcher.test.ts`

- [ ] **Step 1: Delete the directory**

```bash
rm -rf packages/api/src/discovery
```

- [ ] **Step 2: Commit**

```bash
git add -A packages/api/src/discovery
git commit -m "$(cat <<'EOF'
chore(api): remove discovery module

Deletes api-discoverer.ts (live LLM endpoint-config inference) and
direct-fetcher.ts (generic config-driven fetcher), both made obsolete
by the crawler-side adapter registry. handlers.ts is updated in the
next commit to drop the references.
EOF
)"
```

---

## Task 10: Update `crawl_company`/`company_crawled` handlers

**Files:**
- Modify: `packages/api/src/events/handlers.ts`
- Modify: `packages/api/src/events/__tests__/crawl-company-handler.test.ts`

- [ ] **Step 1: Write the failing test**

Replace the contents of `packages/api/src/events/__tests__/crawl-company-handler.test.ts` with:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../db/models.js', () => ({
  SearchSessionModel: { findById: vi.fn() },
  CompanyModel: { findById: vi.fn(), findByIdAndUpdate: vi.fn() },
}))
vi.mock('../../events/queue.js', () => ({ addEvent: vi.fn() }))
vi.mock('axios', () => ({ default: { post: vi.fn() } }))

let eventHandlers: typeof import('../handlers.js')['eventHandlers']
let SearchSessionModel: typeof import('../../db/models.js')['SearchSessionModel']
let CompanyModel: typeof import('../../db/models.js')['CompanyModel']
let addEvent: typeof import('../../events/queue.js')['addEvent']
let axios: typeof import('axios')['default']

const MOCK_SESSION = { _id: 'sess1', userId: 'user1', query: 'engineer' }
const MOCK_SSE = { broadcast: vi.fn() } as any
const HANDLER_DATA = { searchId: 'sess1', companyId: 'co1', url: 'https://ibm.com/careers', companyName: 'IBM', query: 'engineer' }

beforeEach(async () => {
  vi.resetModules()
  ;({ eventHandlers } = await import('../handlers.js'))
  ;({ SearchSessionModel, CompanyModel } = await import('../../db/models.js'))
  ;({ addEvent } = await import('../../events/queue.js'))
  axios = (await import('axios')).default
  vi.clearAllMocks()
})

describe('crawl_company handler', () => {
  describe('standard path: crawler found jobs', () => {
    it('emits company_crawled with crawler jobs and unsupported=false', async () => {
      vi.mocked(SearchSessionModel.findById).mockResolvedValue(MOCK_SESSION as any)
      vi.mocked(axios.post).mockResolvedValue({
        data: { jobs: [{ title: 'Engineer', company: 'IBM' }], unsupported: false, discoveredCompanies: [] },
      })

      await eventHandlers.crawl_company(HANDLER_DATA, MOCK_SSE)

      expect(addEvent).toHaveBeenCalledWith('company_crawled', expect.objectContaining({
        searchId: 'sess1',
        companyId: 'co1',
        jobs: [{ title: 'Engineer', company: 'IBM' }],
        unsupported: false,
      }))
    })
  })

  describe('unsupported path: crawler found no jobs and no adapter matched', () => {
    it('emits company_crawled with unsupported=true', async () => {
      vi.mocked(SearchSessionModel.findById).mockResolvedValue(MOCK_SESSION as any)
      vi.mocked(axios.post).mockResolvedValue({
        data: { jobs: [], unsupported: true, discoveredCompanies: [] },
      })

      await eventHandlers.crawl_company(HANDLER_DATA, MOCK_SSE)

      expect(addEvent).toHaveBeenCalledWith('company_crawled', expect.objectContaining({
        jobs: [],
        unsupported: true,
      }))
    })
  })

  describe('error path: crawler request throws', () => {
    it('sets company status to failed', async () => {
      vi.mocked(SearchSessionModel.findById).mockResolvedValue(MOCK_SESSION as any)
      vi.mocked(axios.post).mockRejectedValue(new Error('timeout'))
      const mockCompany = { status: 'crawling', save: vi.fn() }
      vi.mocked(CompanyModel.findById).mockResolvedValue(mockCompany as any)

      await eventHandlers.crawl_company(HANDLER_DATA, MOCK_SSE)

      expect(mockCompany.status).toBe('failed')
      expect(mockCompany.save).toHaveBeenCalled()
    })
  })
})

describe('company_crawled handler', () => {
  it('sets Company.status to unsupported when data.unsupported is true', async () => {
    vi.mocked(SearchSessionModel.findById).mockResolvedValue({ _id: 'sess1', userId: 'user1', query: 'engineer' } as any)
    const mockCompany = { status: 'crawling', save: vi.fn() }
    vi.mocked(CompanyModel.findById).mockResolvedValue(mockCompany as any)

    await eventHandlers.company_crawled(
      { searchId: 'sess1', companyId: 'co1', jobs: [], discoveredCompanies: [], unsupported: true },
      MOCK_SSE
    )

    expect(mockCompany.status).toBe('unsupported')
    expect(mockCompany.save).toHaveBeenCalled()
  })

  it('sets Company.status to crawled when data.unsupported is false', async () => {
    vi.mocked(SearchSessionModel.findById).mockResolvedValue({ _id: 'sess1', userId: 'user1', query: 'engineer' } as any)
    const mockCompany = { status: 'crawling', save: vi.fn() }
    vi.mocked(CompanyModel.findById).mockResolvedValue(mockCompany as any)

    await eventHandlers.company_crawled(
      { searchId: 'sess1', companyId: 'co1', jobs: [{ title: 'Engineer' }], discoveredCompanies: [], unsupported: false },
      MOCK_SSE
    )

    expect(mockCompany.status).toBe('crawled')
    expect(mockCompany.save).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/api && npm test -- --run crawl-company-handler`
Expected: FAIL — `handlers.ts` still imports `../discovery/api-discoverer.js` and `../discovery/direct-fetcher.js`, which no longer exist, so the test file fails to even import `handlers.js` (module resolution error).

- [ ] **Step 3: Update `packages/api/src/events/handlers.ts`**

Remove these two import lines (currently lines 13-14):

```typescript
import { discoverJobsApi } from '../discovery/api-discoverer.js'
import { fetchFromDiscoveredApi } from '../discovery/direct-fetcher.js'
```

Replace the entire `crawl_company` handler (currently lines 280-383) with:

```typescript
  crawl_company: async (
    data: { searchId: string; companyId: string; url: string; companyName: string; query: string },
    sseManager: SSEManager
  ) => {
    try {
      console.log(`\n🤖 AGENT LOG - Crawl Company`)
      console.log(`   Crawling ${data.companyName} at ${data.url}`)

      const session = await SearchSessionModel.findById(data.searchId)
      if (!session) {
        console.warn('Session not found:', data.searchId)
        return
      }

      const crawlerUrl = process.env.CRAWLER_SERVICE_URL || 'http://localhost:5000'
      const response = await axios.post(
        `${crawlerUrl}/crawler/crawl-company`,
        {
          searchId: data.searchId,
          companyId: data.companyId,
          url: data.url,
          companyName: data.companyName,
          query: data.query,
        },
        { timeout: 90000 }
      )

      const result = response.data
      console.log(`   ✅ Crawled ${data.companyName}: ${result.jobs?.length || 0} jobs found`)

      await addEvent('company_crawled', {
        searchId: data.searchId,
        companyId: data.companyId,
        jobs: result.jobs || [],
        discoveredCompanies: result.discoveredCompanies || [],
        unsupported: result.unsupported || false,
      })
    } catch (error: any) {
      console.error(`Error crawling company ${data.companyName}:`, error.message)
      const company = await CompanyModel.findById(data.companyId)
      if (company) {
        company.status = 'failed'
        await company.save()
      }
    }
  },
```

In the `company_crawled` handler, update the signature (currently lines 385-388) from:

```typescript
  company_crawled: async (
    data: { searchId: string; companyId: string; jobs: any[]; discoveredCompanies: any[] },
    sseManager: SSEManager
  ) => {
```

to:

```typescript
  company_crawled: async (
    data: { searchId: string; companyId: string; jobs: any[]; discoveredCompanies: any[]; unsupported?: boolean },
    sseManager: SSEManager
  ) => {
```

And update the status-setting block (currently lines 399-405) from:

```typescript
      // Update company status to crawled
      const company = await CompanyModel.findById(data.companyId)
      if (company) {
        company.status = 'crawled'
        company.lastCrawlTime = new Date()
        await company.save()
      }
```

to:

```typescript
      // Update company status: unsupported if the crawl found nothing extractable, crawled otherwise
      const company = await CompanyModel.findById(data.companyId)
      if (company) {
        company.status = data.unsupported ? 'unsupported' : 'crawled'
        company.lastCrawlTime = new Date()
        await company.save()
      }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/api && npm test -- --run crawl-company-handler`
Expected: PASS (5 passed)

- [ ] **Step 5: Run the full API test suite**

Run: `cd packages/api && npm test -- --run`
Expected: All tests pass (no regressions from removing the discovery module).

- [ ] **Step 6: Build the API package**

Run: `cd /home/cda/dev/job-search && npm run build --workspace=@job-search/api`
Expected: Build succeeds with no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/events/handlers.ts packages/api/src/events/__tests__/crawl-company-handler.test.ts
git commit -m "$(cat <<'EOF'
feat(api): simplify crawl_company, tag unsupported companies

Drops the discoveredApi fast-path and Playwright-discovery branch from
crawl_company now that adapter dispatch lives entirely in the crawler.
company_crawled sets Company.status = 'unsupported' when the crawler
reports it couldn't extract any jobs, instead of always 'crawled'.
EOF
)"
```

---

## Task 11: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full crawler test suite**

Run: `cd crawler && python3 -m pytest tests/ -q`
Expected: All tests pass.

- [ ] **Step 2: Run the full API test suite**

Run: `cd packages/api && npm test -- --run`
Expected: All tests pass.

- [ ] **Step 3: Build all packages**

Run: `cd /home/cda/dev/job-search && npm run build --workspace=@job-search/shared && npm run build --workspace=@job-search/api && npm run build --workspace=@job-search/frontend`
Expected: All three builds succeed.

- [ ] **Step 4: Confirm no remaining references to removed code**

Run: `grep -rn "discoverJobsApi\|fetchFromDiscoveredApi\|DiscoveredApiConfig\|discoveredApi\|network_interceptor\|CHROMIUM_EXECUTABLE_PATH\|needs_discovery\|network_capture\|CapturedRequest" --include="*.ts" --include="*.py" packages crawler`
Expected: No output (zero matches outside of this plan/spec doc).

- [ ] **Step 5: Confirm no leftover Playwright/browser dependencies**

Run: `grep -n "playwright\|chromium\|firefox" crawler/requirements.txt crawler/Dockerfile`
Expected: No output.
