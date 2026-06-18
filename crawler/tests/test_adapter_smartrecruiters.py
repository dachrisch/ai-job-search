import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import pytest
from unittest.mock import patch, MagicMock
from job_crawler.adapters.smartrecruiters import SmartRecruitersAdapter, _company_slug

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

def test_company_slug_raises_for_bare_domain():
    with pytest.raises(ValueError):
        _company_slug('https://careers.smartrecruiters.com')


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

def test_parse_jobs_description_meets_50_char_minimum_for_thin_records(adapter):
    raw = {'data': SR_RESPONSE_LAST_PAGE, 'source_url': 'https://careers.smartrecruiters.com/Docker',
           'slug': 'Docker', 'offset': 0}
    jobs, _ = adapter.parse_jobs(raw)
    for job in jobs:
        assert len(job['description']) >= 50, f"description too short: {job['description']!r}"
