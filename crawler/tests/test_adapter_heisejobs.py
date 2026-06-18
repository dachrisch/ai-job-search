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
