import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import pytest
from unittest.mock import patch, MagicMock
from job_crawler.adapters.personio import PersonioAdapter

FEED_XML = """<?xml version="1.0" encoding="UTF-8"?>
<workzag-jobs>
  <position>
    <id>1001</id>
    <subcompany>Acme GmbH</subcompany>
    <office>Berlin</office>
    <additionalOffices><office>Remote</office></additionalOffices>
    <department>Engineering</department>
    <name>Senior Python Developer</name>
    <jobDescriptions/>
    <employmentType>permanent</employmentType>
    <schedule>full-time</schedule>
  </position>
  <position>
    <id>1002</id>
    <subcompany>Acme GmbH</subcompany>
    <office>Munich</office>
    <additionalOffices/>
    <department>Data</department>
    <name>Data Engineer</name>
    <jobDescriptions/>
    <employmentType>permanent</employmentType>
    <schedule>full-time</schedule>
  </position>
</workzag-jobs>"""

EMPTY_FEED_XML = """<?xml version="1.0" encoding="UTF-8"?>
<workzag-jobs>
</workzag-jobs>"""


@pytest.fixture
def adapter():
    return PersonioAdapter()


# --- can_handle ---

def test_handles_personio_jobs_de_url(adapter):
    assert adapter.can_handle('https://acme.jobs.personio.de')

def test_handles_personio_jobs_com_url(adapter):
    assert adapter.can_handle('https://acme.jobs.personio.com')

def test_does_not_handle_other_domains(adapter):
    assert not adapter.can_handle('https://acme.greenhouse.io')
    assert not adapter.can_handle('https://example.com/careers')


# --- fetch_page ---

def test_fetch_page_builds_xml_url_from_personio_de(adapter):
    mock_resp = MagicMock()
    mock_resp.text = FEED_XML
    mock_resp.raise_for_status.return_value = None
    with patch('job_crawler.adapters.personio.requests.get', return_value=mock_resp) as mock_get:
        adapter.fetch_page('https://acme.jobs.personio.de', 'python', {}, None)
        assert mock_get.call_args[0][0] == 'https://acme.jobs.personio.de/xml'

def test_fetch_page_builds_xml_url_from_personio_com(adapter):
    mock_resp = MagicMock()
    mock_resp.text = FEED_XML
    mock_resp.raise_for_status.return_value = None
    with patch('job_crawler.adapters.personio.requests.get', return_value=mock_resp) as mock_get:
        adapter.fetch_page('https://acme.jobs.personio.com', 'python', {}, None)
        assert mock_get.call_args[0][0] == 'https://acme.jobs.personio.com/xml'

def test_fetch_page_strips_trailing_path_before_xml(adapter):
    mock_resp = MagicMock()
    mock_resp.text = FEED_XML
    mock_resp.raise_for_status.return_value = None
    with patch('job_crawler.adapters.personio.requests.get', return_value=mock_resp) as mock_get:
        adapter.fetch_page('https://acme.jobs.personio.de/en/jobs', 'python', {}, None)
        assert mock_get.call_args[0][0] == 'https://acme.jobs.personio.de/xml'

def test_fetch_page_returns_xml_and_base_url(adapter):
    mock_resp = MagicMock()
    mock_resp.text = FEED_XML
    mock_resp.raise_for_status.return_value = None
    with patch('job_crawler.adapters.personio.requests.get', return_value=mock_resp):
        raw = adapter.fetch_page('https://acme.jobs.personio.de', 'python', {}, None)
    assert raw['xml'] == FEED_XML
    assert raw['base_url'] == 'https://acme.jobs.personio.de'


# --- parse_jobs: field extraction ---

def test_parse_jobs_extracts_title(adapter):
    jobs, _ = adapter.parse_jobs({'xml': FEED_XML, 'base_url': 'https://acme.jobs.personio.de'})
    assert jobs[0]['title'] == 'Senior Python Developer'

def test_parse_jobs_extracts_company(adapter):
    jobs, _ = adapter.parse_jobs({'xml': FEED_XML, 'base_url': 'https://acme.jobs.personio.de'})
    assert jobs[0]['company'] == 'Acme GmbH'

def test_parse_jobs_extracts_location(adapter):
    jobs, _ = adapter.parse_jobs({'xml': FEED_XML, 'base_url': 'https://acme.jobs.personio.de'})
    assert jobs[0]['location'] == 'Berlin'

def test_parse_jobs_builds_job_url_from_id(adapter):
    jobs, _ = adapter.parse_jobs({'xml': FEED_XML, 'base_url': 'https://acme.jobs.personio.de'})
    assert jobs[0]['url'] == 'https://acme.jobs.personio.de/job/1001'

def test_parse_jobs_sets_source_url(adapter):
    jobs, _ = adapter.parse_jobs({'xml': FEED_XML, 'base_url': 'https://acme.jobs.personio.de'})
    assert jobs[0]['source_url'] == 'https://acme.jobs.personio.de'

def test_parse_jobs_description_meets_50_char_minimum(adapter):
    jobs, _ = adapter.parse_jobs({'xml': FEED_XML, 'base_url': 'https://acme.jobs.personio.de'})
    for job in jobs:
        assert len(job['description']) >= 50, f"description too short: {job['description']!r}"

def test_parse_jobs_returns_all_positions(adapter):
    jobs, _ = adapter.parse_jobs({'xml': FEED_XML, 'base_url': 'https://acme.jobs.personio.de'})
    assert len(jobs) == 2

def test_parse_jobs_returns_empty_list_for_empty_feed(adapter):
    jobs, _ = adapter.parse_jobs({'xml': EMPTY_FEED_XML, 'base_url': 'https://acme.jobs.personio.de'})
    assert jobs == []


# --- pagination ---

def test_parse_jobs_returns_no_next_token(adapter):
    _, next_token = adapter.parse_jobs({'xml': FEED_XML, 'base_url': 'https://acme.jobs.personio.de'})
    assert next_token is None
