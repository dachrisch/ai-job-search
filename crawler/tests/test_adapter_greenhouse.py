import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import pytest
from unittest.mock import patch, MagicMock
from job_crawler.adapters.greenhouse import GreenhouseAdapter, _company_slug

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

def test_company_slug_raises_for_bare_domain():
    with pytest.raises(ValueError):
        _company_slug('https://boards.greenhouse.io')


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
