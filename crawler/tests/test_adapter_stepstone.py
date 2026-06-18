"""Tests for StepStoneAdapter."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import pytest
from unittest.mock import patch, MagicMock
from job_crawler.adapters.stepstone import StepStoneAdapter

# Minimal HTML that mirrors StepStone's real structure (stripped to relevant parts).
ONE_JOB_HTML = """<!DOCTYPE html>
<html><head>
  <link rel="next" href="https://www.stepstone.de/jobs/python-entwickler?page=2&action=paging_next"/>
</head><body>
<article data-at="job-item" id="job-item-13997150">
  <a data-at="job-item-title" href="/stellenangebote--Python-Entwickler-im-KI-Umfeld-w-m-d-Muenster-NRW-BANK--13997150-inline.html">
    <div><div><div>Python-Entwickler im KI-Umfeld (w/m/d)</div></div></div>
  </a>
  <span data-at="job-item-company-name"><span><span></span>NRW.BANK</span></span>
  <span data-at="job-item-location"><span><span></span>Münster</span></span>
  <div data-at="jobcard-content">Wir suchen einen erfahrenen Python-Entwickler für unser KI-Team in Münster.</div>
</article>
</body></html>"""

TWO_JOBS_HTML = """<!DOCTYPE html>
<html><head></head><body>
<article data-at="job-item" id="job-item-1">
  <a data-at="job-item-title" href="/stellenangebote--Senior-Python-Engineer-Berlin-TechCorp--1-inline.html">
    <div>Senior Python Engineer</div>
  </a>
  <span data-at="job-item-company-name"><span>TechCorp GmbH</span></span>
  <span data-at="job-item-location"><span>Berlin</span></span>
  <div data-at="jobcard-content">We are looking for a Senior Python Engineer to join our Berlin team.</div>
</article>
<article data-at="job-item" id="job-item-2">
  <a data-at="job-item-title" href="/stellenangebote--Python-Backend-Developer-Hamburg-Acme--2-inline.html">
    <div>Python Backend Developer</div>
  </a>
  <span data-at="job-item-company-name"><span>Acme AG</span></span>
  <span data-at="job-item-location"><span>Hamburg</span></span>
  <div data-at="jobcard-content">Acme AG is hiring a Python Backend Developer for our Hamburg office.</div>
</article>
</body></html>"""

NO_JOBS_HTML = """<!DOCTYPE html>
<html><head></head><body>
<p>Keine Ergebnisse gefunden.</p>
</body></html>"""

NO_NEXT_HTML = """<!DOCTYPE html>
<html><head></head><body>
<article data-at="job-item" id="job-item-42">
  <a data-at="job-item-title" href="/stellenangebote--Python-Dev--42-inline.html">
    <div>Python Dev</div>
  </a>
  <span data-at="job-item-company-name"><span>ACME</span></span>
  <span data-at="job-item-location"><span>Remote</span></span>
  <div data-at="jobcard-content">Python developer role at ACME in a fully remote environment.</div>
</article>
</body></html>"""


@pytest.fixture
def adapter():
    return StepStoneAdapter()


# --- can_handle ---

def test_handles_stepstone_de_jobs_url(adapter):
    assert adapter.can_handle('https://www.stepstone.de/jobs/python-entwickler')

def test_handles_stepstone_de_generic_url(adapter):
    assert adapter.can_handle('https://www.stepstone.de/')

def test_does_not_handle_other_domains(adapter):
    assert not adapter.can_handle('https://indeed.com/jobs?q=python')
    assert not adapter.can_handle('https://example.com/careers')


# --- fetch_page ---

def test_fetch_page_uses_provided_url(adapter):
    mock_resp = MagicMock()
    mock_resp.text = ONE_JOB_HTML
    mock_resp.raise_for_status.return_value = None
    with patch('job_crawler.adapters.stepstone.requests.get', return_value=mock_resp) as mock_get:
        adapter.fetch_page('https://www.stepstone.de/jobs/python-entwickler', 'python', {}, None)
    assert mock_get.call_args[0][0] == 'https://www.stepstone.de/jobs/python-entwickler'

def test_fetch_page_uses_page_token_when_given(adapter):
    next_url = 'https://www.stepstone.de/jobs/python-entwickler?page=2&action=paging_next'
    mock_resp = MagicMock()
    mock_resp.text = ONE_JOB_HTML
    mock_resp.raise_for_status.return_value = None
    with patch('job_crawler.adapters.stepstone.requests.get', return_value=mock_resp) as mock_get:
        adapter.fetch_page('https://www.stepstone.de/jobs/python-entwickler', 'python', {}, next_url)
    assert mock_get.call_args[0][0] == next_url

def test_fetch_page_sends_user_agent_header(adapter):
    mock_resp = MagicMock()
    mock_resp.text = ONE_JOB_HTML
    mock_resp.raise_for_status.return_value = None
    with patch('job_crawler.adapters.stepstone.requests.get', return_value=mock_resp) as mock_get:
        adapter.fetch_page('https://www.stepstone.de/jobs/python', 'python', {}, None)
    headers = mock_get.call_args[1].get('headers') or mock_get.call_args[0][1] if len(mock_get.call_args[0]) > 1 else mock_get.call_args[1]['headers']
    assert 'User-Agent' in headers

def test_fetch_page_returns_html_and_source_url(adapter):
    mock_resp = MagicMock()
    mock_resp.text = ONE_JOB_HTML
    mock_resp.raise_for_status.return_value = None
    with patch('job_crawler.adapters.stepstone.requests.get', return_value=mock_resp):
        raw = adapter.fetch_page('https://www.stepstone.de/jobs/python', 'python', {}, None)
    assert raw['html'] == ONE_JOB_HTML
    assert 'stepstone.de' in raw['source_url']


# --- parse_jobs: field extraction ---

def test_parse_jobs_extracts_title(adapter):
    jobs, _ = adapter.parse_jobs({'html': ONE_JOB_HTML, 'source_url': 'https://www.stepstone.de/jobs/python-entwickler'})
    assert jobs[0]['title'] == 'Python-Entwickler im KI-Umfeld (w/m/d)'

def test_parse_jobs_extracts_company(adapter):
    jobs, _ = adapter.parse_jobs({'html': ONE_JOB_HTML, 'source_url': 'https://www.stepstone.de/jobs/python-entwickler'})
    assert jobs[0]['company'] == 'NRW.BANK'

def test_parse_jobs_extracts_location(adapter):
    jobs, _ = adapter.parse_jobs({'html': ONE_JOB_HTML, 'source_url': 'https://www.stepstone.de/jobs/python-entwickler'})
    assert jobs[0]['location'] == 'Münster'

def test_parse_jobs_builds_absolute_job_url(adapter):
    jobs, _ = adapter.parse_jobs({'html': ONE_JOB_HTML, 'source_url': 'https://www.stepstone.de/jobs/python-entwickler'})
    assert jobs[0]['url'].startswith('https://www.stepstone.de/stellenangebote--')
    assert '13997150' in jobs[0]['url']

def test_parse_jobs_extracts_description_from_snippet(adapter):
    jobs, _ = adapter.parse_jobs({'html': ONE_JOB_HTML, 'source_url': 'https://www.stepstone.de/jobs/python-entwickler'})
    assert 'Python-Entwickler' in jobs[0]['description']

def test_parse_jobs_description_meets_50_char_minimum(adapter):
    jobs, _ = adapter.parse_jobs({'html': TWO_JOBS_HTML, 'source_url': 'https://www.stepstone.de/jobs/python-entwickler'})
    for job in jobs:
        assert len(job['description']) >= 50, f"description too short: {job['description']!r}"

def test_parse_jobs_sets_source_url(adapter):
    src = 'https://www.stepstone.de/jobs/python-entwickler'
    jobs, _ = adapter.parse_jobs({'html': ONE_JOB_HTML, 'source_url': src})
    assert jobs[0]['source_url'] == src

def test_parse_jobs_returns_all_articles(adapter):
    jobs, _ = adapter.parse_jobs({'html': TWO_JOBS_HTML, 'source_url': 'https://www.stepstone.de/jobs/python'})
    assert len(jobs) == 2

def test_parse_jobs_returns_empty_list_for_no_articles(adapter):
    jobs, _ = adapter.parse_jobs({'html': NO_JOBS_HTML, 'source_url': 'https://www.stepstone.de/jobs/python'})
    assert jobs == []


# --- pagination ---

def test_parse_jobs_returns_next_url_from_rel_next_link(adapter):
    _, next_token = adapter.parse_jobs({'html': ONE_JOB_HTML, 'source_url': 'https://www.stepstone.de/jobs/python-entwickler'})
    assert next_token == 'https://www.stepstone.de/jobs/python-entwickler?page=2&action=paging_next'

def test_parse_jobs_returns_no_next_token_when_no_rel_next(adapter):
    _, next_token = adapter.parse_jobs({'html': NO_NEXT_HTML, 'source_url': 'https://www.stepstone.de/jobs/python'})
    assert next_token is None
