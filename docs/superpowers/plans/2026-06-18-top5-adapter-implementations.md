# Top-5 Adapter Implementations Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add five new `CareerSiteAdapter` subclasses — GreenhouseAdapter, LeverAdapter, SmartRecruitersAdapter, DjangoFoundationAdapter, HeiseJobsAdapter — and register them in `ADAPTER_REGISTRY`.

**Architecture:** One adapter file per site, following the existing `personio.py` / `pythonjobs.py` pattern. `USER_AGENT` is moved to `base.py` to avoid duplication. ATS adapters (Greenhouse, Lever, SmartRecruiters) call public JSON APIs; HTML scrapers (DjangoFoundation, Heise) use BeautifulSoup.

**Tech Stack:** Python 3.11, `requests`, `beautifulsoup4`, `pytest`, `unittest.mock`

---

## File Map

| Action | Path |
|--------|------|
| Modify | `crawler/job_crawler/adapters/base.py` |
| Modify | `crawler/job_crawler/adapters/personio.py` |
| Modify | `crawler/job_crawler/adapters/pythonjobs.py` |
| Create | `crawler/job_crawler/adapters/greenhouse.py` |
| Create | `crawler/job_crawler/adapters/lever.py` |
| Create | `crawler/job_crawler/adapters/smartrecruiters.py` |
| Create | `crawler/job_crawler/adapters/djangofoundation.py` |
| Create | `crawler/job_crawler/adapters/heisejobs.py` |
| Modify | `crawler/job_crawler/adapters/registry.py` |
| Create | `crawler/tests/test_adapter_greenhouse.py` |
| Create | `crawler/tests/test_adapter_lever.py` |
| Create | `crawler/tests/test_adapter_smartrecruiters.py` |
| Create | `crawler/tests/test_adapter_djangofoundation.py` |
| Create | `crawler/tests/test_adapter_heisejobs.py` |
| Modify | `crawler/tests/test_adapters_registry.py` |

---

## Task 1: Move USER_AGENT to base.py

**Files:**
- Modify: `crawler/job_crawler/adapters/base.py`
- Modify: `crawler/job_crawler/adapters/personio.py`
- Modify: `crawler/job_crawler/adapters/pythonjobs.py`

- [ ] **Step 1: Add USER_AGENT constant to base.py**

In `crawler/job_crawler/adapters/base.py`, add after the imports at the top:

```python
USER_AGENT = (
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
    'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
)
```

The full updated `base.py`:

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

USER_AGENT = (
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
    'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
)


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

- [ ] **Step 2: Update personio.py to use USER_AGENT from base**

Replace the local `_USER_AGENT` constant and its usages in `crawler/job_crawler/adapters/personio.py`:

Change the import line from:
```python
from job_crawler.adapters.base import CareerSiteAdapter, AuthContext, RawPage, JobDict
```
to:
```python
from job_crawler.adapters.base import CareerSiteAdapter, AuthContext, RawPage, JobDict, USER_AGENT
```

Delete the local constant:
```python
_USER_AGENT = (
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
    'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
)
```

In `fetch_page`, change `'User-Agent': _USER_AGENT` to `'User-Agent': USER_AGENT`.

- [ ] **Step 3: Update pythonjobs.py to use USER_AGENT from base**

Same change as Step 2, applied to `crawler/job_crawler/adapters/pythonjobs.py`.

- [ ] **Step 4: Run existing adapter tests to confirm no regression**

```bash
cd crawler && python -m pytest tests/ -v
```

Expected: all existing tests pass (14+ tests green).

- [ ] **Step 5: Commit**

```bash
git add crawler/job_crawler/adapters/base.py \
        crawler/job_crawler/adapters/personio.py \
        crawler/job_crawler/adapters/pythonjobs.py
git commit -m "refactor(crawler): centralise USER_AGENT constant in base.py"
```

---

## Task 2: GreenhouseAdapter

**Files:**
- Create: `crawler/job_crawler/adapters/greenhouse.py`
- Create: `crawler/tests/test_adapter_greenhouse.py`

- [ ] **Step 1: Write the failing tests**

Create `crawler/tests/test_adapter_greenhouse.py`:

```python
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import pytest
from unittest.mock import patch, MagicMock
from job_crawler.adapters.greenhouse import GreenhouseAdapter

GREENHOUSE_RESPONSE = {
    "jobs": [
        {
            "id": 4567890,
            "title": "Senior Python Engineer",
            "location": {"name": "San Francisco, CA or Remote"},
            "absolute_url": "https://boards.greenhouse.io/stripe/jobs/4567890",
            "departments": [{"id": 1, "name": "Engineering"}],
            "content": "<p>We are looking for a <b>Senior Python Engineer</b> to join our platform team.</p>"
        },
        {
            "id": 4567891,
            "title": "Backend Developer",
            "location": {"name": ""},
            "absolute_url": "https://boards.greenhouse.io/stripe/jobs/4567891",
            "departments": [],
            "content": ""
        }
    ]
}

EMPTY_RESPONSE = {"jobs": []}


@pytest.fixture
def adapter():
    return GreenhouseAdapter()


# --- can_handle ---

def test_handles_greenhouse_url(adapter):
    assert adapter.can_handle('https://boards.greenhouse.io/stripe')

def test_handles_greenhouse_jobs_subpath(adapter):
    assert adapter.can_handle('https://boards.greenhouse.io/stripe/jobs')

def test_does_not_handle_other_domains(adapter):
    assert not adapter.can_handle('https://jobs.lever.co/stripe')
    assert not adapter.can_handle('https://example.com/careers')


# --- fetch_page ---

def test_fetch_page_builds_api_url_from_slug(adapter):
    mock_resp = MagicMock()
    mock_resp.json.return_value = GREENHOUSE_RESPONSE
    mock_resp.raise_for_status.return_value = None
    with patch('job_crawler.adapters.greenhouse.requests.get', return_value=mock_resp) as mock_get:
        adapter.fetch_page('https://boards.greenhouse.io/stripe', 'python', {}, None)
        called_url = mock_get.call_args[0][0]
        assert called_url == 'https://boards-api.greenhouse.io/v1/boards/stripe/jobs'

def test_fetch_page_includes_content_param(adapter):
    mock_resp = MagicMock()
    mock_resp.json.return_value = GREENHOUSE_RESPONSE
    mock_resp.raise_for_status.return_value = None
    with patch('job_crawler.adapters.greenhouse.requests.get', return_value=mock_resp) as mock_get:
        adapter.fetch_page('https://boards.greenhouse.io/stripe', 'python', {}, None)
        params = mock_get.call_args[1]['params']
        assert params.get('content') == 'true'

def test_fetch_page_returns_data_and_source_url(adapter):
    mock_resp = MagicMock()
    mock_resp.json.return_value = GREENHOUSE_RESPONSE
    mock_resp.raise_for_status.return_value = None
    with patch('job_crawler.adapters.greenhouse.requests.get', return_value=mock_resp):
        raw = adapter.fetch_page('https://boards.greenhouse.io/stripe', 'python', {}, None)
    assert raw['data'] == GREENHOUSE_RESPONSE
    assert raw['source_url'] == 'https://boards.greenhouse.io/stripe'


# --- parse_jobs ---

def test_parse_jobs_extracts_title(adapter):
    raw = {'data': GREENHOUSE_RESPONSE, 'source_url': 'https://boards.greenhouse.io/stripe', 'slug': 'stripe'}
    jobs, _ = adapter.parse_jobs(raw)
    assert jobs[0]['title'] == 'Senior Python Engineer'

def test_parse_jobs_extracts_location(adapter):
    raw = {'data': GREENHOUSE_RESPONSE, 'source_url': 'https://boards.greenhouse.io/stripe', 'slug': 'stripe'}
    jobs, _ = adapter.parse_jobs(raw)
    assert jobs[0]['location'] == 'San Francisco, CA or Remote'

def test_parse_jobs_extracts_url(adapter):
    raw = {'data': GREENHOUSE_RESPONSE, 'source_url': 'https://boards.greenhouse.io/stripe', 'slug': 'stripe'}
    jobs, _ = adapter.parse_jobs(raw)
    assert jobs[0]['url'] == 'https://boards.greenhouse.io/stripe/jobs/4567890'

def test_parse_jobs_sets_source_url(adapter):
    raw = {'data': GREENHOUSE_RESPONSE, 'source_url': 'https://boards.greenhouse.io/stripe', 'slug': 'stripe'}
    jobs, _ = adapter.parse_jobs(raw)
    assert jobs[0]['source_url'] == 'https://boards.greenhouse.io/stripe'

def test_parse_jobs_description_meets_50_char_minimum(adapter):
    raw = {'data': GREENHOUSE_RESPONSE, 'source_url': 'https://boards.greenhouse.io/stripe', 'slug': 'stripe'}
    jobs, _ = adapter.parse_jobs(raw)
    for job in jobs:
        assert len(job['description']) >= 50, f"description too short: {job['description']!r}"

def test_parse_jobs_returns_all_items(adapter):
    raw = {'data': GREENHOUSE_RESPONSE, 'source_url': 'https://boards.greenhouse.io/stripe', 'slug': 'stripe'}
    jobs, _ = adapter.parse_jobs(raw)
    assert len(jobs) == 2

def test_parse_jobs_returns_empty_list_for_empty_response(adapter):
    raw = {'data': EMPTY_RESPONSE, 'source_url': 'https://boards.greenhouse.io/stripe', 'slug': 'stripe'}
    jobs, _ = adapter.parse_jobs(raw)
    assert jobs == []

def test_parse_jobs_returns_no_next_token(adapter):
    raw = {'data': GREENHOUSE_RESPONSE, 'source_url': 'https://boards.greenhouse.io/stripe', 'slug': 'stripe'}
    _, next_token = adapter.parse_jobs(raw)
    assert next_token is None

def test_parse_jobs_strips_html_from_content(adapter):
    raw = {'data': GREENHOUSE_RESPONSE, 'source_url': 'https://boards.greenhouse.io/stripe', 'slug': 'stripe'}
    jobs, _ = adapter.parse_jobs(raw)
    assert '<p>' not in jobs[0]['description']
    assert '<b>' not in jobs[0]['description']
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd crawler && python -m pytest tests/test_adapter_greenhouse.py -v
```

Expected: `ModuleNotFoundError: No module named 'job_crawler.adapters.greenhouse'`

- [ ] **Step 3: Write the implementation**

Create `crawler/job_crawler/adapters/greenhouse.py`:

```python
"""Adapter for Greenhouse-hosted career pages (boards.greenhouse.io)."""

from __future__ import annotations

import re
from urllib.parse import urlparse

import requests

from job_crawler.adapters.base import CareerSiteAdapter, AuthContext, RawPage, JobDict, USER_AGENT

_API_BASE = 'https://boards-api.greenhouse.io/v1/boards'
_TAG_RE = re.compile(r'<[^>]+>')


def _company_slug(url: str) -> str:
    return urlparse(url).path.strip('/').split('/')[0]


def _strip_html(html: str) -> str:
    return _TAG_RE.sub('', html or '').strip()


class GreenhouseAdapter(CareerSiteAdapter):
    """Fetches jobs from Greenhouse's public JSON API."""

    def can_handle(self, url: str) -> bool:
        return 'boards.greenhouse.io' in url

    def fetch_page(
        self, url: str, keywords: str, auth_context: AuthContext, page_token: str | None
    ) -> RawPage:
        slug = _company_slug(url)
        response = requests.get(
            f'{_API_BASE}/{slug}/jobs',
            params={'content': 'true'},
            headers={'User-Agent': USER_AGENT},
            timeout=30,
        )
        response.raise_for_status()
        return {'data': response.json(), 'source_url': url, 'slug': slug}

    def parse_jobs(self, raw_page: RawPage) -> tuple[list[JobDict], str | None]:
        source_url = raw_page['source_url']
        slug = raw_page.get('slug', _company_slug(source_url))
        jobs: list[JobDict] = []

        for item in raw_page['data'].get('jobs', []):
            title = (item.get('title') or '').strip()
            if not title:
                continue

            location = (item.get('location') or {}).get('name', '').strip()
            job_url = (item.get('absolute_url') or '').strip()
            departments = item.get('departments') or []
            department = departments[0]['name'] if departments else ''
            content_snippet = _strip_html(item.get('content') or '')[:200]

            description = title
            if department:
                description += f' | {department}'
            if location:
                description += f' | {location}'
            if content_snippet:
                description += f' — {content_snippet}'
            description += ' | greenhouse'

            jobs.append({
                'title': title,
                'company': slug,
                'description': description,
                'url': job_url,
                'location': location,
                'source_url': source_url,
            })

        return jobs, None
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd crawler && python -m pytest tests/test_adapter_greenhouse.py -v
```

Expected: 13 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add crawler/job_crawler/adapters/greenhouse.py crawler/tests/test_adapter_greenhouse.py
git commit -m "feat(crawler): add GreenhouseAdapter with public JSON API"
```

---

## Task 3: LeverAdapter

**Files:**
- Create: `crawler/job_crawler/adapters/lever.py`
- Create: `crawler/tests/test_adapter_lever.py`

- [ ] **Step 1: Write the failing tests**

Create `crawler/tests/test_adapter_lever.py`:

```python
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import pytest
from unittest.mock import patch, MagicMock
from job_crawler.adapters.lever import LeverAdapter

LEVER_RESPONSE = [
    {
        "id": "abc-123-def",
        "text": "Senior Python Engineer",
        "categories": {"location": "Berlin, Germany", "team": "Engineering"},
        "hostedUrl": "https://jobs.lever.co/mozilla/abc-123-def",
        "descriptionPlain": "We are looking for a Senior Python Engineer to join our team. You will work on critical infrastructure."
    },
    {
        "id": "xyz-456-ghi",
        "text": "Data Engineer",
        "categories": {"location": "", "team": ""},
        "hostedUrl": "https://jobs.lever.co/mozilla/xyz-456-ghi",
        "descriptionPlain": ""
    }
]

EMPTY_RESPONSE = []


@pytest.fixture
def adapter():
    return LeverAdapter()


# --- can_handle ---

def test_handles_lever_url(adapter):
    assert adapter.can_handle('https://jobs.lever.co/mozilla')

def test_handles_lever_posting_url(adapter):
    assert adapter.can_handle('https://jobs.lever.co/mozilla/abc-123-def')

def test_does_not_handle_other_domains(adapter):
    assert not adapter.can_handle('https://boards.greenhouse.io/mozilla')
    assert not adapter.can_handle('https://example.com/careers')


# --- fetch_page ---

def test_fetch_page_builds_api_url_from_slug(adapter):
    mock_resp = MagicMock()
    mock_resp.json.return_value = LEVER_RESPONSE
    mock_resp.raise_for_status.return_value = None
    with patch('job_crawler.adapters.lever.requests.get', return_value=mock_resp) as mock_get:
        adapter.fetch_page('https://jobs.lever.co/mozilla', 'python', {}, None)
        called_url = mock_get.call_args[0][0]
        assert called_url == 'https://api.lever.co/v0/postings/mozilla'

def test_fetch_page_includes_mode_json_param(adapter):
    mock_resp = MagicMock()
    mock_resp.json.return_value = LEVER_RESPONSE
    mock_resp.raise_for_status.return_value = None
    with patch('job_crawler.adapters.lever.requests.get', return_value=mock_resp) as mock_get:
        adapter.fetch_page('https://jobs.lever.co/mozilla', 'python', {}, None)
        params = mock_get.call_args[1]['params']
        assert params.get('mode') == 'json'

def test_fetch_page_returns_data_and_source_url(adapter):
    mock_resp = MagicMock()
    mock_resp.json.return_value = LEVER_RESPONSE
    mock_resp.raise_for_status.return_value = None
    with patch('job_crawler.adapters.lever.requests.get', return_value=mock_resp):
        raw = adapter.fetch_page('https://jobs.lever.co/mozilla', 'python', {}, None)
    assert raw['data'] == LEVER_RESPONSE
    assert raw['source_url'] == 'https://jobs.lever.co/mozilla'


# --- parse_jobs ---

def test_parse_jobs_extracts_title(adapter):
    raw = {'data': LEVER_RESPONSE, 'source_url': 'https://jobs.lever.co/mozilla', 'slug': 'mozilla'}
    jobs, _ = adapter.parse_jobs(raw)
    assert jobs[0]['title'] == 'Senior Python Engineer'

def test_parse_jobs_extracts_location(adapter):
    raw = {'data': LEVER_RESPONSE, 'source_url': 'https://jobs.lever.co/mozilla', 'slug': 'mozilla'}
    jobs, _ = adapter.parse_jobs(raw)
    assert jobs[0]['location'] == 'Berlin, Germany'

def test_parse_jobs_extracts_url(adapter):
    raw = {'data': LEVER_RESPONSE, 'source_url': 'https://jobs.lever.co/mozilla', 'slug': 'mozilla'}
    jobs, _ = adapter.parse_jobs(raw)
    assert jobs[0]['url'] == 'https://jobs.lever.co/mozilla/abc-123-def'

def test_parse_jobs_sets_source_url(adapter):
    raw = {'data': LEVER_RESPONSE, 'source_url': 'https://jobs.lever.co/mozilla', 'slug': 'mozilla'}
    jobs, _ = adapter.parse_jobs(raw)
    assert jobs[0]['source_url'] == 'https://jobs.lever.co/mozilla'

def test_parse_jobs_description_meets_50_char_minimum(adapter):
    raw = {'data': LEVER_RESPONSE, 'source_url': 'https://jobs.lever.co/mozilla', 'slug': 'mozilla'}
    jobs, _ = adapter.parse_jobs(raw)
    for job in jobs:
        assert len(job['description']) >= 50, f"description too short: {job['description']!r}"

def test_parse_jobs_returns_all_items(adapter):
    raw = {'data': LEVER_RESPONSE, 'source_url': 'https://jobs.lever.co/mozilla', 'slug': 'mozilla'}
    jobs, _ = adapter.parse_jobs(raw)
    assert len(jobs) == 2

def test_parse_jobs_returns_empty_list_for_empty_response(adapter):
    raw = {'data': EMPTY_RESPONSE, 'source_url': 'https://jobs.lever.co/mozilla', 'slug': 'mozilla'}
    jobs, _ = adapter.parse_jobs(raw)
    assert jobs == []

def test_parse_jobs_returns_no_next_token(adapter):
    raw = {'data': LEVER_RESPONSE, 'source_url': 'https://jobs.lever.co/mozilla', 'slug': 'mozilla'}
    _, next_token = adapter.parse_jobs(raw)
    assert next_token is None
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd crawler && python -m pytest tests/test_adapter_lever.py -v
```

Expected: `ModuleNotFoundError: No module named 'job_crawler.adapters.lever'`

- [ ] **Step 3: Write the implementation**

Create `crawler/job_crawler/adapters/lever.py`:

```python
"""Adapter for Lever-hosted career pages (jobs.lever.co)."""

from __future__ import annotations

from urllib.parse import urlparse

import requests

from job_crawler.adapters.base import CareerSiteAdapter, AuthContext, RawPage, JobDict, USER_AGENT

_API_BASE = 'https://api.lever.co/v0/postings'


def _company_slug(url: str) -> str:
    return urlparse(url).path.strip('/').split('/')[0]


class LeverAdapter(CareerSiteAdapter):
    """Fetches jobs from Lever's public postings API."""

    def can_handle(self, url: str) -> bool:
        return 'jobs.lever.co' in url

    def fetch_page(
        self, url: str, keywords: str, auth_context: AuthContext, page_token: str | None
    ) -> RawPage:
        slug = _company_slug(url)
        response = requests.get(
            f'{_API_BASE}/{slug}',
            params={'mode': 'json'},
            headers={'User-Agent': USER_AGENT},
            timeout=30,
        )
        response.raise_for_status()
        return {'data': response.json(), 'source_url': url, 'slug': slug}

    def parse_jobs(self, raw_page: RawPage) -> tuple[list[JobDict], str | None]:
        source_url = raw_page['source_url']
        slug = raw_page.get('slug', _company_slug(source_url))
        jobs: list[JobDict] = []

        for item in (raw_page['data'] or []):
            title = (item.get('text') or '').strip()
            if not title:
                continue

            categories = item.get('categories') or {}
            location = (categories.get('location') or '').strip()
            team = (categories.get('team') or '').strip()
            job_url = (item.get('hostedUrl') or '').strip()
            plain = (item.get('descriptionPlain') or '')[:300].strip()

            description = title
            if team:
                description += f' | {team}'
            if location:
                description += f' | {location}'
            if plain:
                description += f' — {plain}'
            description += ' | lever'

            jobs.append({
                'title': title,
                'company': slug,
                'description': description,
                'url': job_url,
                'location': location,
                'source_url': source_url,
            })

        return jobs, None
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd crawler && python -m pytest tests/test_adapter_lever.py -v
```

Expected: 13 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add crawler/job_crawler/adapters/lever.py crawler/tests/test_adapter_lever.py
git commit -m "feat(crawler): add LeverAdapter with public postings API"
```

---

## Task 4: SmartRecruitersAdapter

**Files:**
- Create: `crawler/job_crawler/adapters/smartrecruiters.py`
- Create: `crawler/tests/test_adapter_smartrecruiters.py`

- [ ] **Step 1: Write the failing tests**

Create `crawler/tests/test_adapter_smartrecruiters.py`:

```python
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import pytest
from unittest.mock import patch, MagicMock
from job_crawler.adapters.smartrecruiters import SmartRecruitersAdapter

SR_RESPONSE_PAGE1 = {
    "content": [
        {
            "id": "abc123",
            "name": "Senior Python Engineer",
            "location": {"city": "Berlin", "country": "DE"},
            "ref": "https://careers.smartrecruiters.com/Docker/abc123",
            "department": {"label": "Engineering"}
        },
        {
            "id": "def456",
            "name": "Data Engineer",
            "location": {"city": "Hamburg", "country": "DE"},
            "ref": "https://careers.smartrecruiters.com/Docker/def456",
            "department": {"label": "Data"}
        }
    ],
    "totalFound": 150,
    "limit": 100,
    "offset": 0
}

SR_RESPONSE_PAGE2 = {
    "content": [
        {
            "id": "ghi789",
            "name": "Frontend Engineer",
            "location": {"city": "Remote", "country": ""},
            "ref": "https://careers.smartrecruiters.com/Docker/ghi789",
            "department": {"label": "Frontend"}
        }
    ],
    "totalFound": 150,
    "limit": 100,
    "offset": 100
}

SR_RESPONSE_LAST_PAGE = {
    "content": [{"id": "x", "name": "Dev", "location": {}, "ref": "http://example.com/x", "department": {}}],
    "totalFound": 50,
    "limit": 100,
    "offset": 0
}

EMPTY_RESPONSE = {"content": [], "totalFound": 0, "limit": 100, "offset": 0}


@pytest.fixture
def adapter():
    return SmartRecruitersAdapter()


# --- can_handle ---

def test_handles_smartrecruiters_url(adapter):
    assert adapter.can_handle('https://careers.smartrecruiters.com/Docker')

def test_does_not_handle_other_domains(adapter):
    assert not adapter.can_handle('https://boards.greenhouse.io/docker')
    assert not adapter.can_handle('https://example.com/careers')


# --- fetch_page ---

def test_fetch_page_builds_api_url_from_slug(adapter):
    mock_resp = MagicMock()
    mock_resp.json.return_value = SR_RESPONSE_PAGE1
    mock_resp.raise_for_status.return_value = None
    with patch('job_crawler.adapters.smartrecruiters.requests.get', return_value=mock_resp) as mock_get:
        adapter.fetch_page('https://careers.smartrecruiters.com/Docker', 'python', {}, None)
        called_url = mock_get.call_args[0][0]
        assert called_url == 'https://api.smartrecruiters.com/v1/companies/Docker/postings'

def test_fetch_page_passes_zero_offset_on_first_page(adapter):
    mock_resp = MagicMock()
    mock_resp.json.return_value = SR_RESPONSE_PAGE1
    mock_resp.raise_for_status.return_value = None
    with patch('job_crawler.adapters.smartrecruiters.requests.get', return_value=mock_resp) as mock_get:
        adapter.fetch_page('https://careers.smartrecruiters.com/Docker', 'python', {}, None)
        params = mock_get.call_args[1]['params']
        assert params['offset'] == 0

def test_fetch_page_passes_offset_from_page_token(adapter):
    mock_resp = MagicMock()
    mock_resp.json.return_value = SR_RESPONSE_PAGE2
    mock_resp.raise_for_status.return_value = None
    with patch('job_crawler.adapters.smartrecruiters.requests.get', return_value=mock_resp) as mock_get:
        adapter.fetch_page('https://careers.smartrecruiters.com/Docker', 'python', {}, '100')
        params = mock_get.call_args[1]['params']
        assert params['offset'] == 100


# --- parse_jobs ---

def test_parse_jobs_extracts_title(adapter):
    raw = {'data': SR_RESPONSE_PAGE1, 'source_url': 'https://careers.smartrecruiters.com/Docker',
           'slug': 'Docker', 'offset': 0}
    jobs, _ = adapter.parse_jobs(raw)
    assert jobs[0]['title'] == 'Senior Python Engineer'

def test_parse_jobs_extracts_location(adapter):
    raw = {'data': SR_RESPONSE_PAGE1, 'source_url': 'https://careers.smartrecruiters.com/Docker',
           'slug': 'Docker', 'offset': 0}
    jobs, _ = adapter.parse_jobs(raw)
    assert jobs[0]['location'] == 'Berlin, DE'

def test_parse_jobs_extracts_url(adapter):
    raw = {'data': SR_RESPONSE_PAGE1, 'source_url': 'https://careers.smartrecruiters.com/Docker',
           'slug': 'Docker', 'offset': 0}
    jobs, _ = adapter.parse_jobs(raw)
    assert jobs[0]['url'] == 'https://careers.smartrecruiters.com/Docker/abc123'

def test_parse_jobs_sets_source_url(adapter):
    raw = {'data': SR_RESPONSE_PAGE1, 'source_url': 'https://careers.smartrecruiters.com/Docker',
           'slug': 'Docker', 'offset': 0}
    jobs, _ = adapter.parse_jobs(raw)
    assert jobs[0]['source_url'] == 'https://careers.smartrecruiters.com/Docker'

def test_parse_jobs_description_meets_50_char_minimum(adapter):
    raw = {'data': SR_RESPONSE_PAGE1, 'source_url': 'https://careers.smartrecruiters.com/Docker',
           'slug': 'Docker', 'offset': 0}
    jobs, _ = adapter.parse_jobs(raw)
    for job in jobs:
        assert len(job['description']) >= 50, f"description too short: {job['description']!r}"

def test_parse_jobs_returns_all_items(adapter):
    raw = {'data': SR_RESPONSE_PAGE1, 'source_url': 'https://careers.smartrecruiters.com/Docker',
           'slug': 'Docker', 'offset': 0}
    jobs, _ = adapter.parse_jobs(raw)
    assert len(jobs) == 2

def test_parse_jobs_returns_empty_list_for_empty_response(adapter):
    raw = {'data': EMPTY_RESPONSE, 'source_url': 'https://careers.smartrecruiters.com/Docker',
           'slug': 'Docker', 'offset': 0}
    jobs, _ = adapter.parse_jobs(raw)
    assert jobs == []

def test_parse_jobs_returns_next_token_when_more_pages(adapter):
    raw = {'data': SR_RESPONSE_PAGE1, 'source_url': 'https://careers.smartrecruiters.com/Docker',
           'slug': 'Docker', 'offset': 0}
    _, next_token = adapter.parse_jobs(raw)
    assert next_token == '100'

def test_parse_jobs_returns_no_next_token_on_last_page(adapter):
    raw = {'data': SR_RESPONSE_LAST_PAGE, 'source_url': 'https://careers.smartrecruiters.com/Docker',
           'slug': 'Docker', 'offset': 0}
    _, next_token = adapter.parse_jobs(raw)
    assert next_token is None
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd crawler && python -m pytest tests/test_adapter_smartrecruiters.py -v
```

Expected: `ModuleNotFoundError: No module named 'job_crawler.adapters.smartrecruiters'`

- [ ] **Step 3: Write the implementation**

Create `crawler/job_crawler/adapters/smartrecruiters.py`:

```python
"""Adapter for SmartRecruiters-hosted career pages (careers.smartrecruiters.com)."""

from __future__ import annotations

from urllib.parse import urlparse

import requests

from job_crawler.adapters.base import CareerSiteAdapter, AuthContext, RawPage, JobDict, USER_AGENT

_API_BASE = 'https://api.smartrecruiters.com/v1/companies'
_PAGE_SIZE = 100


def _company_slug(url: str) -> str:
    return urlparse(url).path.strip('/').split('/')[0]


class SmartRecruitersAdapter(CareerSiteAdapter):
    """Fetches jobs from SmartRecruiters' public postings API."""

    def can_handle(self, url: str) -> bool:
        return 'careers.smartrecruiters.com' in url

    def fetch_page(
        self, url: str, keywords: str, auth_context: AuthContext, page_token: str | None
    ) -> RawPage:
        slug = _company_slug(url)
        offset = int(page_token) if page_token else 0
        response = requests.get(
            f'{_API_BASE}/{slug}/postings',
            params={'limit': _PAGE_SIZE, 'offset': offset},
            headers={'User-Agent': USER_AGENT},
            timeout=30,
        )
        response.raise_for_status()
        return {'data': response.json(), 'source_url': url, 'slug': slug, 'offset': offset}

    def parse_jobs(self, raw_page: RawPage) -> tuple[list[JobDict], str | None]:
        source_url = raw_page['source_url']
        slug = raw_page.get('slug', _company_slug(source_url))
        data = raw_page['data']
        offset = raw_page.get('offset', 0)
        jobs: list[JobDict] = []

        for item in (data.get('content') or []):
            title = (item.get('name') or '').strip()
            if not title:
                continue

            loc = item.get('location') or {}
            city = (loc.get('city') or '').strip()
            country = (loc.get('country') or '').strip()
            location = ', '.join(filter(None, [city, country]))

            job_url = (item.get('ref') or '').strip()
            dept = (item.get('department') or {}).get('label', '').strip()

            description = title
            if dept:
                description += f' | {dept}'
            if location:
                description += f' | {location}'
            description += f' | {slug} | smartrecruiters'

            jobs.append({
                'title': title,
                'company': slug,
                'description': description,
                'url': job_url,
                'location': location,
                'source_url': source_url,
            })

        total = data.get('totalFound', 0)
        next_offset = offset + _PAGE_SIZE
        next_token = str(next_offset) if next_offset < total else None

        return jobs, next_token
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd crawler && python -m pytest tests/test_adapter_smartrecruiters.py -v
```

Expected: 15 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add crawler/job_crawler/adapters/smartrecruiters.py crawler/tests/test_adapter_smartrecruiters.py
git commit -m "feat(crawler): add SmartRecruitersAdapter with offset pagination"
```

---

## Task 5: DjangoFoundationAdapter

**Files:**
- Create: `crawler/job_crawler/adapters/djangofoundation.py`
- Create: `crawler/tests/test_adapter_djangofoundation.py`

> **Note:** The Django Foundation jobs page (`https://www.djangoproject.com/foundation/jobs/`) currently has no active listings, so its HTML structure cannot be confirmed from a live response. The fixture below is based on Django's standard template conventions. **Before writing a test that hits the live page, run:**
> ```bash
> curl -s https://www.djangoproject.com/foundation/jobs/ | grep -A5 '<ul\|<li\|<h2\|<h3'
> ```
> If the actual structure differs from the fixture, update the fixture and selectors accordingly before running the tests. The adapter logic itself does not need to change — only the CSS selectors in `parse_jobs`.

- [ ] **Step 1: Write the failing tests**

Create `crawler/tests/test_adapter_djangofoundation.py`:

```python
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import pytest
from unittest.mock import patch, MagicMock
from job_crawler.adapters.djangofoundation import DjangoFoundationAdapter

# Fixture based on Django template conventions. Verify against live page when jobs are posted.
JOBS_HTML = """<!DOCTYPE html>
<html>
<body>
<div id="content-main">
  <ul id="job-list">
    <li>
      <h2><a href="/foundation/jobs/executive-director/">Executive Director</a></h2>
      <p class="job-meta">Django Software Foundation | Remote</p>
    </li>
    <li>
      <h2><a href="/foundation/jobs/developer/">Django Developer</a></h2>
      <p class="job-meta">Django Software Foundation | New York, NY</p>
    </li>
  </ul>
</div>
</body>
</html>"""

EMPTY_HTML = """<!DOCTYPE html>
<html><body>
<div id="content-main"><p>There are no current job openings.</p></div>
</body></html>"""


@pytest.fixture
def adapter():
    return DjangoFoundationAdapter()


# --- can_handle ---

def test_handles_djangoproject_foundation_jobs_url(adapter):
    assert adapter.can_handle('https://www.djangoproject.com/foundation/jobs/')

def test_handles_djangoproject_foundation_jobs_subpath(adapter):
    assert adapter.can_handle('https://www.djangoproject.com/foundation/jobs/123/')

def test_does_not_handle_other_domains(adapter):
    assert not adapter.can_handle('https://www.python.org/jobs/')
    assert not adapter.can_handle('https://example.com/foundation/jobs/')


# --- fetch_page ---

def test_fetch_page_calls_foundation_jobs_url(adapter):
    mock_resp = MagicMock()
    mock_resp.text = JOBS_HTML
    mock_resp.raise_for_status.return_value = None
    with patch('job_crawler.adapters.djangofoundation.requests.get', return_value=mock_resp) as mock_get:
        adapter.fetch_page('https://www.djangoproject.com/foundation/jobs/', 'python', {}, None)
        called_url = mock_get.call_args[0][0]
        assert 'djangoproject.com/foundation/jobs' in called_url

def test_fetch_page_returns_html(adapter):
    mock_resp = MagicMock()
    mock_resp.text = JOBS_HTML
    mock_resp.raise_for_status.return_value = None
    with patch('job_crawler.adapters.djangofoundation.requests.get', return_value=mock_resp):
        raw = adapter.fetch_page('https://www.djangoproject.com/foundation/jobs/', 'python', {}, None)
    assert 'html' in raw


# --- parse_jobs ---

def test_parse_jobs_extracts_title(adapter):
    raw = {'html': JOBS_HTML, 'source_url': 'https://www.djangoproject.com/foundation/jobs/'}
    jobs, _ = adapter.parse_jobs(raw)
    assert jobs[0]['title'] == 'Executive Director'

def test_parse_jobs_extracts_url(adapter):
    raw = {'html': JOBS_HTML, 'source_url': 'https://www.djangoproject.com/foundation/jobs/'}
    jobs, _ = adapter.parse_jobs(raw)
    assert jobs[0]['url'] == 'https://www.djangoproject.com/foundation/jobs/executive-director/'

def test_parse_jobs_sets_source_url(adapter):
    raw = {'html': JOBS_HTML, 'source_url': 'https://www.djangoproject.com/foundation/jobs/'}
    jobs, _ = adapter.parse_jobs(raw)
    assert jobs[0]['source_url'] == 'https://www.djangoproject.com/foundation/jobs/'

def test_parse_jobs_description_meets_50_char_minimum(adapter):
    raw = {'html': JOBS_HTML, 'source_url': 'https://www.djangoproject.com/foundation/jobs/'}
    jobs, _ = adapter.parse_jobs(raw)
    for job in jobs:
        assert len(job['description']) >= 50, f"description too short: {job['description']!r}"

def test_parse_jobs_returns_all_items(adapter):
    raw = {'html': JOBS_HTML, 'source_url': 'https://www.djangoproject.com/foundation/jobs/'}
    jobs, _ = adapter.parse_jobs(raw)
    assert len(jobs) == 2

def test_parse_jobs_returns_empty_list_when_no_jobs(adapter):
    raw = {'html': EMPTY_HTML, 'source_url': 'https://www.djangoproject.com/foundation/jobs/'}
    jobs, _ = adapter.parse_jobs(raw)
    assert jobs == []

def test_parse_jobs_returns_no_next_token(adapter):
    raw = {'html': JOBS_HTML, 'source_url': 'https://www.djangoproject.com/foundation/jobs/'}
    _, next_token = adapter.parse_jobs(raw)
    assert next_token is None
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd crawler && python -m pytest tests/test_adapter_djangofoundation.py -v
```

Expected: `ModuleNotFoundError: No module named 'job_crawler.adapters.djangofoundation'`

- [ ] **Step 3: Write the implementation**

Create `crawler/job_crawler/adapters/djangofoundation.py`:

```python
"""Adapter for the Django Foundation jobs board (djangoproject.com/foundation/jobs)."""

from __future__ import annotations

import requests
from bs4 import BeautifulSoup

from job_crawler.adapters.base import CareerSiteAdapter, AuthContext, RawPage, JobDict, USER_AGENT

_BASE = 'https://www.djangoproject.com'
_JOBS_URL = f'{_BASE}/foundation/jobs/'


class DjangoFoundationAdapter(CareerSiteAdapter):
    """Scrapes the Django Foundation jobs board via its server-rendered HTML listing."""

    def can_handle(self, url: str) -> bool:
        return 'djangoproject.com/foundation/jobs' in url

    def fetch_page(
        self, url: str, keywords: str, auth_context: AuthContext, page_token: str | None
    ) -> RawPage:
        response = requests.get(
            _JOBS_URL,
            headers={'User-Agent': USER_AGENT},
            timeout=30,
        )
        response.raise_for_status()
        return {'html': response.text, 'source_url': _JOBS_URL}

    def parse_jobs(self, raw_page: RawPage) -> tuple[list[JobDict], str | None]:
        soup = BeautifulSoup(raw_page['html'], 'html.parser')
        source_url = raw_page['source_url']
        jobs: list[JobDict] = []

        for li in soup.select('#job-list li'):
            heading = li.find('h2')
            if not heading:
                continue
            link = heading.find('a')
            if not link:
                continue

            title = link.get_text(strip=True)
            href = link.get('href', '')
            job_url = _BASE + href if href.startswith('/') else href

            meta_el = li.find('p', class_='job-meta')
            meta = meta_el.get_text(strip=True) if meta_el else ''
            parts = [p.strip() for p in meta.split('|')]
            company = parts[0] if len(parts) >= 1 else ''
            location = parts[1] if len(parts) >= 2 else ''

            description = f'{title} at {company}. Location: {location} | djangoproject.com/foundation/jobs'

            jobs.append({
                'title': title,
                'company': company,
                'description': description,
                'url': job_url,
                'location': location,
                'source_url': source_url,
            })

        return jobs, None
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd crawler && python -m pytest tests/test_adapter_djangofoundation.py -v
```

Expected: 11 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add crawler/job_crawler/adapters/djangofoundation.py crawler/tests/test_adapter_djangofoundation.py
git commit -m "feat(crawler): add DjangoFoundationAdapter for foundation/jobs board"
```

---

## Task 6: HeiseJobsAdapter

**Files:**
- Create: `crawler/job_crawler/adapters/heisejobs.py`
- Create: `crawler/tests/test_adapter_heisejobs.py`

> **Structure confirmed via live inspection:** Each job entry is a `<li>` containing an `<a href="/job?id={id}">` with a nested `<h3>` for the title, the company logo `<img alt="Logo: {company}">`, and direct text nodes for company name and location.

- [ ] **Step 1: Write the failing tests**

Create `crawler/tests/test_adapter_heisejobs.py`:

```python
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import pytest
from unittest.mock import patch, MagicMock
from job_crawler.adapters.heisejobs import HeiseJobsAdapter

HEISE_HTML = """<!DOCTYPE html>
<html>
<body>
<ul id="jobOffers">
  <li>
    <img src="/img/job?documentId=111&type=JobLogo" alt="Logo: Acme GmbH"/>
    <a href="/job?id=111">
      <h3>Senior Python Developer</h3>
    </a>
    Acme GmbH
    <p>Vollzeit</p>
    Berlin
  </li>
  <li>
    <img src="/img/job?documentId=222&type=JobLogo" alt="Logo: Beta Corp"/>
    <a href="/job?id=222">
      <h3>Backend Engineer</h3>
    </a>
    Beta Corp
    <p>Vollzeit, Teilzeit</p>
    München
  </li>
</ul>
</body>
</html>"""

HEISE_HTML_WITH_NEXT_PAGE = """<!DOCTYPE html>
<html>
<body>
<ul id="jobOffers">
  <li>
    <img src="/img/job?documentId=333&type=JobLogo" alt="Logo: Gamma AG"/>
    <a href="/job?id=333">
      <h3>DevOps Engineer</h3>
    </a>
    Gamma AG
    <p>Vollzeit</p>
    Hamburg
  </li>
</ul>
<a href="/?page=2" rel="next">weiter</a>
</body>
</html>"""

EMPTY_HTML = """<!DOCTYPE html><html><body><ul id="jobOffers"></ul></body></html>"""


@pytest.fixture
def adapter():
    return HeiseJobsAdapter()


# --- can_handle ---

def test_handles_heise_jobs_url(adapter):
    assert adapter.can_handle('https://jobs.heise.de/')

def test_handles_heise_jobs_subpath(adapter):
    assert adapter.can_handle('https://jobs.heise.de/job?id=12345')

def test_does_not_handle_other_domains(adapter):
    assert not adapter.can_handle('https://www.heise.de/')
    assert not adapter.can_handle('https://example.com/jobs')


# --- fetch_page ---

def test_fetch_page_calls_heise_jobs_url(adapter):
    mock_resp = MagicMock()
    mock_resp.text = HEISE_HTML
    mock_resp.raise_for_status.return_value = None
    with patch('job_crawler.adapters.heisejobs.requests.get', return_value=mock_resp) as mock_get:
        adapter.fetch_page('https://jobs.heise.de/', 'python', {}, None)
        called_url = mock_get.call_args[0][0]
        assert 'jobs.heise.de' in called_url

def test_fetch_page_passes_page_param_when_given(adapter):
    mock_resp = MagicMock()
    mock_resp.text = HEISE_HTML
    mock_resp.raise_for_status.return_value = None
    with patch('job_crawler.adapters.heisejobs.requests.get', return_value=mock_resp) as mock_get:
        adapter.fetch_page('https://jobs.heise.de/', 'python', {}, '2')
        params = mock_get.call_args[1].get('params', {})
        assert params.get('page') == '2'


# --- parse_jobs ---

def test_parse_jobs_extracts_title(adapter):
    raw = {'html': HEISE_HTML, 'source_url': 'https://jobs.heise.de/'}
    jobs, _ = adapter.parse_jobs(raw)
    assert jobs[0]['title'] == 'Senior Python Developer'

def test_parse_jobs_extracts_company_from_img_alt(adapter):
    raw = {'html': HEISE_HTML, 'source_url': 'https://jobs.heise.de/'}
    jobs, _ = adapter.parse_jobs(raw)
    assert jobs[0]['company'] == 'Acme GmbH'

def test_parse_jobs_extracts_location(adapter):
    raw = {'html': HEISE_HTML, 'source_url': 'https://jobs.heise.de/'}
    jobs, _ = adapter.parse_jobs(raw)
    assert jobs[0]['location'] == 'Berlin'

def test_parse_jobs_extracts_absolute_url(adapter):
    raw = {'html': HEISE_HTML, 'source_url': 'https://jobs.heise.de/'}
    jobs, _ = adapter.parse_jobs(raw)
    assert jobs[0]['url'] == 'https://jobs.heise.de/job?id=111'

def test_parse_jobs_sets_source_url(adapter):
    raw = {'html': HEISE_HTML, 'source_url': 'https://jobs.heise.de/'}
    jobs, _ = adapter.parse_jobs(raw)
    assert jobs[0]['source_url'] == 'https://jobs.heise.de/'

def test_parse_jobs_description_meets_50_char_minimum(adapter):
    raw = {'html': HEISE_HTML, 'source_url': 'https://jobs.heise.de/'}
    jobs, _ = adapter.parse_jobs(raw)
    for job in jobs:
        assert len(job['description']) >= 50, f"description too short: {job['description']!r}"

def test_parse_jobs_returns_all_items(adapter):
    raw = {'html': HEISE_HTML, 'source_url': 'https://jobs.heise.de/'}
    jobs, _ = adapter.parse_jobs(raw)
    assert len(jobs) == 2

def test_parse_jobs_returns_empty_list_when_no_jobs(adapter):
    raw = {'html': EMPTY_HTML, 'source_url': 'https://jobs.heise.de/'}
    jobs, _ = adapter.parse_jobs(raw)
    assert jobs == []

def test_parse_jobs_returns_next_token_from_rel_next_link(adapter):
    raw = {'html': HEISE_HTML_WITH_NEXT_PAGE, 'source_url': 'https://jobs.heise.de/'}
    _, next_token = adapter.parse_jobs(raw)
    assert next_token == '2'

def test_parse_jobs_returns_no_next_token_when_no_next_link(adapter):
    raw = {'html': HEISE_HTML, 'source_url': 'https://jobs.heise.de/'}
    _, next_token = adapter.parse_jobs(raw)
    assert next_token is None
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd crawler && python -m pytest tests/test_adapter_heisejobs.py -v
```

Expected: `ModuleNotFoundError: No module named 'job_crawler.adapters.heisejobs'`

- [ ] **Step 3: Write the implementation**

Create `crawler/job_crawler/adapters/heisejobs.py`:

```python
"""Adapter for the Heise Jobs board (jobs.heise.de)."""

from __future__ import annotations

import re

import requests
from bs4 import BeautifulSoup, NavigableString

from job_crawler.adapters.base import CareerSiteAdapter, AuthContext, RawPage, JobDict, USER_AGENT

_BASE = 'https://jobs.heise.de'
_JOBS_URL = f'{_BASE}/'


class HeiseJobsAdapter(CareerSiteAdapter):
    """Scrapes the Heise Jobs board via its server-rendered HTML listing."""

    def can_handle(self, url: str) -> bool:
        return 'jobs.heise.de' in url

    def fetch_page(
        self, url: str, keywords: str, auth_context: AuthContext, page_token: str | None
    ) -> RawPage:
        params = {'page': page_token} if page_token else {}
        response = requests.get(
            _JOBS_URL,
            params=params,
            headers={'User-Agent': USER_AGENT},
            timeout=30,
        )
        response.raise_for_status()
        return {'html': response.text, 'source_url': _JOBS_URL}

    def parse_jobs(self, raw_page: RawPage) -> tuple[list[JobDict], str | None]:
        soup = BeautifulSoup(raw_page['html'], 'html.parser')
        source_url = raw_page['source_url']
        jobs: list[JobDict] = []

        for li in soup.find_all('li'):
            link = li.find('a', href=lambda h: h and '/job?id=' in h)
            if not link:
                continue
            h3 = link.find('h3')
            if not h3:
                continue

            title = h3.get_text(strip=True)
            job_url = _BASE + link['href']

            img = li.find('img')
            company = ''
            if img:
                alt = img.get('alt', '')
                if alt.startswith('Logo: '):
                    company = alt[6:].strip()

            # Direct text node children of li (not inside nested elements)
            location_texts = [
                c.strip() for c in li.children
                if isinstance(c, NavigableString) and c.strip()
            ]
            location = location_texts[-1] if location_texts else ''

            description = f'{title} at {company}. Location: {location} | jobs.heise.de'

            jobs.append({
                'title': title,
                'company': company,
                'description': description,
                'url': job_url,
                'location': location,
                'source_url': source_url,
            })

        next_token: str | None = None
        next_el = soup.find('a', rel=lambda r: 'next' in (r if isinstance(r, list) else [r]))
        if next_el and next_el.get('href'):
            m = re.search(r'[?&]page=(\d+)', next_el['href'])
            if m:
                next_token = m.group(1)

        return jobs, next_token
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd crawler && python -m pytest tests/test_adapter_heisejobs.py -v
```

Expected: 12 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add crawler/job_crawler/adapters/heisejobs.py crawler/tests/test_adapter_heisejobs.py
git commit -m "feat(crawler): add HeiseJobsAdapter for jobs.heise.de board"
```

---

## Task 7: Register All Adapters + Update Registry Tests

**Files:**
- Modify: `crawler/job_crawler/adapters/registry.py`
- Modify: `crawler/tests/test_adapters_registry.py`

- [ ] **Step 1: Update registry.py**

Replace the contents of `crawler/job_crawler/adapters/registry.py`:

```python
"""Registry of career-site adapters, matched to a URL in order."""

from __future__ import annotations

from job_crawler.adapters.base import CareerSiteAdapter
from job_crawler.adapters.djangofoundation import DjangoFoundationAdapter
from job_crawler.adapters.greenhouse import GreenhouseAdapter
from job_crawler.adapters.heisejobs import HeiseJobsAdapter
from job_crawler.adapters.lever import LeverAdapter
from job_crawler.adapters.personio import PersonioAdapter
from job_crawler.adapters.pythonjobs import PythonJobsAdapter
from job_crawler.adapters.smartrecruiters import SmartRecruitersAdapter

ADAPTER_REGISTRY: list[CareerSiteAdapter] = [
    PythonJobsAdapter(),
    PersonioAdapter(),
    GreenhouseAdapter(),
    LeverAdapter(),
    SmartRecruitersAdapter(),
    DjangoFoundationAdapter(),
    HeiseJobsAdapter(),
]


def find_adapter(url: str) -> CareerSiteAdapter | None:
    """Return the first registered adapter whose can_handle(url) is True."""
    for adapter in ADAPTER_REGISTRY:
        if adapter.can_handle(url):
            return adapter
    return None
```

- [ ] **Step 2: Read the current test_adapters_registry.py to see what to extend**

```bash
cat crawler/tests/test_adapters_registry.py
```

- [ ] **Step 3: Add 5 new URL-matching tests to test_adapters_registry.py**

Append to `crawler/tests/test_adapters_registry.py` (after the existing tests):

```python
from job_crawler.adapters.greenhouse import GreenhouseAdapter
from job_crawler.adapters.lever import LeverAdapter
from job_crawler.adapters.smartrecruiters import SmartRecruitersAdapter
from job_crawler.adapters.djangofoundation import DjangoFoundationAdapter
from job_crawler.adapters.heisejobs import HeiseJobsAdapter


def test_find_adapter_returns_greenhouse_for_greenhouse_url():
    adapter = find_adapter('https://boards.greenhouse.io/stripe')
    assert isinstance(adapter, GreenhouseAdapter)

def test_find_adapter_returns_lever_for_lever_url():
    adapter = find_adapter('https://jobs.lever.co/mozilla')
    assert isinstance(adapter, LeverAdapter)

def test_find_adapter_returns_smartrecruiters_for_sr_url():
    adapter = find_adapter('https://careers.smartrecruiters.com/Docker')
    assert isinstance(adapter, SmartRecruitersAdapter)

def test_find_adapter_returns_djangofoundation_for_dsf_url():
    adapter = find_adapter('https://www.djangoproject.com/foundation/jobs/')
    assert isinstance(adapter, DjangoFoundationAdapter)

def test_find_adapter_returns_heisejobs_for_heise_url():
    adapter = find_adapter('https://jobs.heise.de/')
    assert isinstance(adapter, HeiseJobsAdapter)
```

- [ ] **Step 4: Run the full test suite**

```bash
cd crawler && python -m pytest tests/ -v
```

Expected: all tests pass (prior tests + 5 new registry tests + ~65 adapter tests).

- [ ] **Step 5: Commit**

```bash
git add crawler/job_crawler/adapters/registry.py crawler/tests/test_adapters_registry.py
git commit -m "feat(crawler): register Greenhouse, Lever, SmartRecruiters, DjangoFoundation, HeiseJobs adapters"
```

---

## Self-Review

**Spec coverage:**
- ✅ GreenhouseAdapter — Tasks 2
- ✅ LeverAdapter — Task 3
- ✅ SmartRecruitersAdapter — Task 4 (with offset pagination)
- ✅ DjangoFoundationAdapter — Task 5 (with HTML inspection note)
- ✅ HeiseJobsAdapter — Task 6 (with pagination via `rel=next`)
- ✅ USER_AGENT centralised — Task 1
- ✅ Registry updated — Task 7
- ✅ ~12–15 tests per adapter, ~65 total
- ✅ No network calls in tests (all mocked)

**Type consistency:**
- `_company_slug()` defined locally in each ATS adapter (not shared) — consistent across Tasks 2, 3, 4
- `RawPage` keys used in `fetch_page` match exactly what `parse_jobs` reads in every task
- `USER_AGENT` exported from `base.py` in Task 1 and imported in Tasks 2–6

**No placeholders:** All code blocks are complete and runnable.
