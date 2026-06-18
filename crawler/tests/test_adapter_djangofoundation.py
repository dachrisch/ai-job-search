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

def test_parse_jobs_extracts_company(adapter):
    raw = {'html': JOBS_HTML, 'source_url': 'https://www.djangoproject.com/foundation/jobs/'}
    jobs, _ = adapter.parse_jobs(raw)
    assert jobs[0]['company'] == 'Django Software Foundation'

def test_parse_jobs_extracts_location(adapter):
    raw = {'html': JOBS_HTML, 'source_url': 'https://www.djangoproject.com/foundation/jobs/'}
    jobs, _ = adapter.parse_jobs(raw)
    assert jobs[0]['location'] == 'Remote'

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
