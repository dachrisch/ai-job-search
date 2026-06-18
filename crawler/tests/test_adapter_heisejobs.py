import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import pytest
from unittest.mock import patch, MagicMock
from job_crawler.adapters.heisejobs import HeiseJobsAdapter

# HTML matching the live site redesign (React/Next.js, data-testid selectors)
HEISE_SEARCH_HTML = """<!DOCTYPE html>
<html>
<body>
<section data-testid="seo-landing-page-jobs">
<ul>
  <li data-id="111" data-testid="joblist-job-1" class="jsx-abc">
    <div class="jli">
      <section class="jsx-abc logo">
        <img srcset="..." alt="Logo: Acme GmbH" loading="lazy" class="jsx-def">
        <h2 data-testid="joblist-job-1-title" class="jsx-ghi">
          <span data-testid="top-badge" class="inline-flex">TOP</span>Senior Python Developer
        </h2>
        <span class="jsx-jkl">Acme GmbH</span>
      </section>
      <section class="jsx-mno">
        <div class="jsx-mno hours"><svg></svg><span class="jsx-mno">Vollzeit</span></div>
        <div class="jsx-mno loc"><svg></svg><span class="jsx-mno">Berlin</span></div>
      </section>
      <a rel="nofollow" href="/search?q=python&amp;selected=111"></a>
    </div>
  </li>
  <li data-id="222" data-testid="joblist-job-2" class="jsx-abc">
    <div class="jli">
      <section class="jsx-abc logo">
        <img srcset="..." alt="Logo: Beta Corp" loading="lazy" class="jsx-def">
        <h2 data-testid="joblist-job-2-title" class="jsx-ghi">Backend Engineer</h2>
        <span class="jsx-jkl">Beta Corp</span>
      </section>
      <section class="jsx-pqr">
        <div class="jsx-pqr age"><svg></svg><span class="jsx-pqr datetext">neu</span></div>
        <div class="jsx-pqr hours"><svg></svg><span class="jsx-pqr">Vollzeit</span></div>
      </section>
      <a rel="nofollow" href="/search?q=python&amp;selected=222"></a>
    </div>
  </li>
</ul>
</section>
</body>
</html>"""

EMPTY_HTML = """<!DOCTYPE html>
<html><body>
<section data-testid="seo-landing-page-jobs"><ul></ul></section>
</body></html>"""


@pytest.fixture
def adapter():
    return HeiseJobsAdapter()


# --- can_handle ---

def test_handles_heise_jobs_url(adapter):
    assert adapter.can_handle('https://jobs.heise.de/')

def test_handles_heise_jobs_search_url(adapter):
    assert adapter.can_handle('https://jobs.heise.de/search?q=python')

def test_handles_heise_jobs_subpath(adapter):
    assert adapter.can_handle('https://jobs.heise.de/job?id=12345')

def test_does_not_handle_other_domains(adapter):
    assert not adapter.can_handle('https://www.heise.de/')
    assert not adapter.can_handle('https://example.com/jobs')


# --- fetch_page ---

def test_fetch_page_calls_search_url(adapter):
    mock_resp = MagicMock()
    mock_resp.text = HEISE_SEARCH_HTML
    mock_resp.url = 'https://jobs.heise.de/search?q=python'
    mock_resp.raise_for_status.return_value = None
    with patch('job_crawler.adapters.heisejobs.requests.get', return_value=mock_resp) as mock_get:
        adapter.fetch_page('https://jobs.heise.de/', 'python', {}, None)
        called_url = mock_get.call_args[0][0]
        assert '/search' in called_url

def test_fetch_page_passes_keywords_as_q_param(adapter):
    mock_resp = MagicMock()
    mock_resp.text = HEISE_SEARCH_HTML
    mock_resp.url = 'https://jobs.heise.de/search?q=python'
    mock_resp.raise_for_status.return_value = None
    with patch('job_crawler.adapters.heisejobs.requests.get', return_value=mock_resp) as mock_get:
        adapter.fetch_page('https://jobs.heise.de/', 'python developer', {}, None)
        params = mock_get.call_args[1].get('params', {})
        assert params.get('q') == 'python developer'

def test_fetch_page_sends_user_agent_header(adapter):
    mock_resp = MagicMock()
    mock_resp.text = HEISE_SEARCH_HTML
    mock_resp.url = 'https://jobs.heise.de/search?q=python'
    mock_resp.raise_for_status.return_value = None
    with patch('job_crawler.adapters.heisejobs.requests.get', return_value=mock_resp) as mock_get:
        adapter.fetch_page('https://jobs.heise.de/', 'python', {}, None)
        headers = mock_get.call_args[1].get('headers', {})
        assert 'User-Agent' in headers
        assert headers['User-Agent']


# --- parse_jobs ---

def test_parse_jobs_extracts_title_stripping_top_badge(adapter):
    raw = {'html': HEISE_SEARCH_HTML, 'source_url': 'https://jobs.heise.de/search?q=python'}
    jobs, _ = adapter.parse_jobs(raw)
    assert jobs[0]['title'] == 'Senior Python Developer'

def test_parse_jobs_extracts_title_without_badge(adapter):
    raw = {'html': HEISE_SEARCH_HTML, 'source_url': 'https://jobs.heise.de/search?q=python'}
    jobs, _ = adapter.parse_jobs(raw)
    assert jobs[1]['title'] == 'Backend Engineer'

def test_parse_jobs_extracts_company_from_img_alt(adapter):
    raw = {'html': HEISE_SEARCH_HTML, 'source_url': 'https://jobs.heise.de/search?q=python'}
    jobs, _ = adapter.parse_jobs(raw)
    assert jobs[0]['company'] == 'Acme GmbH'
    assert jobs[1]['company'] == 'Beta Corp'

def test_parse_jobs_extracts_location_from_loc_div(adapter):
    raw = {'html': HEISE_SEARCH_HTML, 'source_url': 'https://jobs.heise.de/search?q=python'}
    jobs, _ = adapter.parse_jobs(raw)
    assert jobs[0]['location'] == 'Berlin'

def test_parse_jobs_location_empty_when_no_loc_div(adapter):
    raw = {'html': HEISE_SEARCH_HTML, 'source_url': 'https://jobs.heise.de/search?q=python'}
    jobs, _ = adapter.parse_jobs(raw)
    assert jobs[1]['location'] == ''

def test_parse_jobs_constructs_url_from_data_id(adapter):
    raw = {'html': HEISE_SEARCH_HTML, 'source_url': 'https://jobs.heise.de/search?q=python'}
    jobs, _ = adapter.parse_jobs(raw)
    assert jobs[0]['url'] == 'https://jobs.heise.de/job?id=111'
    assert jobs[1]['url'] == 'https://jobs.heise.de/job?id=222'

def test_parse_jobs_sets_source_url(adapter):
    src = 'https://jobs.heise.de/search?q=python'
    raw = {'html': HEISE_SEARCH_HTML, 'source_url': src}
    jobs, _ = adapter.parse_jobs(raw)
    assert jobs[0]['source_url'] == src

def test_parse_jobs_description_meets_50_char_minimum(adapter):
    raw = {'html': HEISE_SEARCH_HTML, 'source_url': 'https://jobs.heise.de/search?q=python'}
    jobs, _ = adapter.parse_jobs(raw)
    for job in jobs:
        assert len(job['description']) >= 50, f"description too short: {job['description']!r}"

def test_parse_jobs_returns_all_items(adapter):
    raw = {'html': HEISE_SEARCH_HTML, 'source_url': 'https://jobs.heise.de/search?q=python'}
    jobs, _ = adapter.parse_jobs(raw)
    assert len(jobs) == 2

def test_parse_jobs_returns_empty_list_when_no_jobs(adapter):
    raw = {'html': EMPTY_HTML, 'source_url': 'https://jobs.heise.de/search?q=python'}
    jobs, _ = adapter.parse_jobs(raw)
    assert jobs == []

def test_parse_jobs_returns_no_next_token(adapter):
    raw = {'html': HEISE_SEARCH_HTML, 'source_url': 'https://jobs.heise.de/search?q=python'}
    _, next_token = adapter.parse_jobs(raw)
    assert next_token is None
