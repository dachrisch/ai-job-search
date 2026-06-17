import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from unittest.mock import patch

from cli import _try_adapter
from job_crawler.adapters.base import CareerSiteAdapter

VALID_JOB = {
    'title': 'Senior Backend Engineer',
    'company': 'Acme',
    'description': 'A' * 60,
    'url': 'https://acme.com/jobs/1',
    'location': 'Remote',
    'source_url': 'https://acme.com/careers',
}


class _MatchingAdapter(CareerSiteAdapter):
    def __init__(self, jobs=None, raises=False):
        self._jobs = jobs or []
        self._raises = raises

    def can_handle(self, url):
        return True

    def fetch_page(self, url, keywords, auth_context, page_token):
        return {}

    def parse_jobs(self, raw_page):
        return self._jobs, None

    def run(self, url, keywords):
        if self._raises:
            raise RuntimeError('boom')
        return self._jobs


def test_returns_none_when_no_adapter_matches():
    with patch('cli.find_adapter', return_value=None):
        assert _try_adapter('https://example.com/careers', 'engineer') is None


def test_returns_validated_jobs_when_adapter_matches():
    adapter = _MatchingAdapter(jobs=[VALID_JOB])
    with patch('cli.find_adapter', return_value=adapter):
        result = _try_adapter('https://acme.com/careers', 'engineer')
    assert result is not None
    assert len(result) == 1
    assert result[0]['title'] == 'Senior Backend Engineer'


def test_returns_none_when_adapter_raises():
    adapter = _MatchingAdapter(raises=True)
    with patch('cli.find_adapter', return_value=adapter):
        assert _try_adapter('https://acme.com/careers', 'engineer') is None


def test_returns_none_when_adapter_jobs_fail_validation():
    invalid_job = {**VALID_JOB, 'title': 'short'}
    adapter = _MatchingAdapter(jobs=[invalid_job])
    with patch('cli.find_adapter', return_value=adapter):
        assert _try_adapter('https://acme.com/careers', 'engineer') is None
