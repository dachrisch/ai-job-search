import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import pytest
from unittest.mock import patch, MagicMock
from job_crawler.adapters.pythonjobs import PythonJobsAdapter

# Fixture HTML matching actual python.org/jobs structure (condensed but faithful)
PAGE_1 = """
<html><body>
<ol class="list-recent-jobs list-row-container menu">
    <li>
        <h2 class="listing-company">
            <span class="listing-company-name">
                <span class="listing-new">New</span>
                <a href="/jobs/8093/">Python / DevOps Engineer for Voice-AI</a><br/>
                JB Martyn
            </span>
            <span class="listing-location">
                <a href="/jobs/location/illinois/">Illinois, Chicago, United States</a>
            </span>
        </h2>
        <span class="listing-job-type">
            <a href="/jobs/type/back-end/">Back end</a>,
            <a href="/jobs/type/cloud/">Cloud</a>
        </span>
    </li>
    <li>
        <h2 class="listing-company">
            <span class="listing-company-name">
                <a href="/jobs/8092/">Senior Python Engineer</a><br/>
                ActivePrime, Inc.
            </span>
            <span class="listing-location">
                <a href="/jobs/location/remote/">Remote</a>
            </span>
        </h2>
        <span class="listing-job-type">
            <a href="/jobs/type/back-end/">Back end</a>
        </span>
    </li>
</ol>
<ul class="pagination menu">
    <li class="previous"><a class="disabled" href="">Prev</a></li>
    <li><a class="active" href="?page=1">1</a></li>
    <li><a href="?page=2">2</a></li>
    <li class="next"><a href="?page=2">Next</a></li>
</ul>
</body></html>
"""

PAGE_2_LAST = """
<html><body>
<ol class="list-recent-jobs list-row-container menu">
    <li>
        <h2 class="listing-company">
            <span class="listing-company-name">
                <a href="/jobs/8089/">Django Backend Developer</a><br/>
                Widgets Co.
            </span>
            <span class="listing-location">
                <a href="/jobs/location/remote/">Remote</a>
            </span>
        </h2>
        <span class="listing-job-type">
            <a href="/jobs/type/web/">Web</a>
        </span>
    </li>
</ol>
<ul class="pagination menu">
    <li class="previous"><a href="?page=1">Prev</a></li>
    <li><a href="?page=1">1</a></li>
    <li><a class="active" href="?page=2">2</a></li>
</ul>
</body></html>
"""


@pytest.fixture
def adapter():
    return PythonJobsAdapter()


# --- can_handle ---

def test_handles_python_org_jobs_url(adapter):
    assert adapter.can_handle('https://www.python.org/jobs/')

def test_does_not_handle_other_domains(adapter):
    assert not adapter.can_handle('https://django.org/jobs/')
    assert not adapter.can_handle('https://www.python.org/community/')


# --- parse_jobs: field extraction ---

def test_parse_jobs_extracts_title(adapter):
    jobs, _ = adapter.parse_jobs({'html': PAGE_1})
    assert jobs[0]['title'] == 'Python / DevOps Engineer for Voice-AI'

def test_parse_jobs_strips_new_badge_from_company(adapter):
    jobs, _ = adapter.parse_jobs({'html': PAGE_1})
    assert jobs[0]['company'] == 'JB Martyn'

def test_parse_jobs_extracts_company_without_new_badge(adapter):
    jobs, _ = adapter.parse_jobs({'html': PAGE_1})
    assert jobs[1]['company'] == 'ActivePrime, Inc.'

def test_parse_jobs_extracts_location(adapter):
    jobs, _ = adapter.parse_jobs({'html': PAGE_1})
    assert jobs[0]['location'] == 'Illinois, Chicago, United States'

def test_parse_jobs_extracts_absolute_url(adapter):
    jobs, _ = adapter.parse_jobs({'html': PAGE_1})
    assert jobs[0]['url'] == 'https://www.python.org/jobs/8093/'

def test_parse_jobs_sets_source_url_to_jobs_listing(adapter):
    jobs, _ = adapter.parse_jobs({'html': PAGE_1})
    assert jobs[0]['source_url'] == 'https://www.python.org/jobs/'

def test_parse_jobs_description_meets_50_char_minimum(adapter):
    jobs, _ = adapter.parse_jobs({'html': PAGE_1})
    for job in jobs:
        assert len(job['description']) >= 50, f"description too short: {job['description']!r}"

def test_parse_jobs_returns_all_jobs_on_page(adapter):
    jobs, _ = adapter.parse_jobs({'html': PAGE_1})
    assert len(jobs) == 2


# --- parse_jobs: pagination ---

def test_parse_jobs_returns_next_token_when_next_page_exists(adapter):
    _, next_token = adapter.parse_jobs({'html': PAGE_1})
    assert next_token == '2'

def test_parse_jobs_returns_no_next_token_on_last_page(adapter):
    _, next_token = adapter.parse_jobs({'html': PAGE_2_LAST})
    assert next_token is None


# --- fetch_page ---

def test_fetch_page_sends_page_token_as_query_param(adapter):
    mock_resp = MagicMock()
    mock_resp.text = PAGE_2_LAST
    mock_resp.raise_for_status.return_value = None
    with patch('job_crawler.adapters.pythonjobs.requests.get', return_value=mock_resp) as mock_get:
        adapter.fetch_page('https://www.python.org/jobs/', 'python', {}, '2')
        _, kwargs = mock_get.call_args
        assert kwargs['params'] == {'page': '2'}

def test_fetch_page_sends_no_page_param_on_first_page(adapter):
    mock_resp = MagicMock()
    mock_resp.text = PAGE_1
    mock_resp.raise_for_status.return_value = None
    with patch('job_crawler.adapters.pythonjobs.requests.get', return_value=mock_resp) as mock_get:
        adapter.fetch_page('https://www.python.org/jobs/', 'python', {}, None)
        _, kwargs = mock_get.call_args
        assert kwargs['params'] == {}

def test_fetch_page_returns_html_in_raw_page(adapter):
    mock_resp = MagicMock()
    mock_resp.text = PAGE_1
    mock_resp.raise_for_status.return_value = None
    with patch('job_crawler.adapters.pythonjobs.requests.get', return_value=mock_resp):
        raw = adapter.fetch_page('https://www.python.org/jobs/', 'python', {}, None)
    assert 'html' in raw
    assert 'list-recent-jobs' in raw['html']
