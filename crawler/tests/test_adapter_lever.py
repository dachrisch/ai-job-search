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
