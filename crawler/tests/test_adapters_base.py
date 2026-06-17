import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import pytest
from job_crawler.adapters.base import CareerSiteAdapter


class _StubAdapter(CareerSiteAdapter):
    """Minimal adapter for exercising the base run() orchestrator."""

    def __init__(self, pages):
        self._pages = pages
        self.fetch_calls = []

    def can_handle(self, url):
        return True

    def fetch_page(self, url, keywords, auth_context, page_token):
        self.fetch_calls.append(page_token)
        return self._pages[len(self.fetch_calls) - 1]

    def parse_jobs(self, raw_page):
        return raw_page['jobs'], raw_page.get('next_token')


def test_run_single_page_returns_jobs():
    adapter = _StubAdapter(pages=[{'jobs': [{'title': 'Engineer'}], 'next_token': None}])
    jobs = adapter.run('https://example.com/careers', 'engineer')
    assert jobs == [{'title': 'Engineer'}]
    assert adapter.fetch_calls == [None]


def test_run_follows_pagination_token():
    adapter = _StubAdapter(pages=[
        {'jobs': [{'title': 'Engineer 1'}], 'next_token': 'page2'},
        {'jobs': [{'title': 'Engineer 2'}], 'next_token': None},
    ])
    jobs = adapter.run('https://example.com/careers', 'engineer')
    assert jobs == [{'title': 'Engineer 1'}, {'title': 'Engineer 2'}]
    assert adapter.fetch_calls == [None, 'page2']


def test_run_stops_after_max_pages():
    pages = [{'jobs': [{'title': f'Engineer {i}'}], 'next_token': 'more'} for i in range(20)]
    adapter = _StubAdapter(pages=pages)
    jobs = adapter.run('https://example.com/careers', 'engineer')
    assert len(jobs) == 10
    assert len(adapter.fetch_calls) == 10


def test_authenticate_defaults_to_empty_context():
    adapter = _StubAdapter(pages=[{'jobs': [], 'next_token': None}])
    assert adapter.authenticate('https://example.com/careers') == {}


def test_cannot_instantiate_without_required_hooks():
    with pytest.raises(TypeError):
        CareerSiteAdapter()
