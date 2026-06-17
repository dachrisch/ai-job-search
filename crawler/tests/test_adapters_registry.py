import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from job_crawler.adapters.base import CareerSiteAdapter
from job_crawler.adapters import registry


class _WorkdayStub(CareerSiteAdapter):
    def can_handle(self, url):
        return 'myworkdayjobs.com' in url

    def fetch_page(self, url, keywords, auth_context, page_token):
        return {}

    def parse_jobs(self, raw_page):
        return [], None


class _GreenhouseStub(CareerSiteAdapter):
    def can_handle(self, url):
        return 'greenhouse.io' in url

    def fetch_page(self, url, keywords, auth_context, page_token):
        return {}

    def parse_jobs(self, raw_page):
        return [], None


def test_find_adapter_returns_matching_adapter(monkeypatch):
    workday = _WorkdayStub()
    greenhouse = _GreenhouseStub()
    monkeypatch.setattr(registry, 'ADAPTER_REGISTRY', [workday, greenhouse])

    assert registry.find_adapter('https://ibm.wd3.myworkdayjobs.com/jobs') is workday
    assert registry.find_adapter('https://boards.greenhouse.io/stripe') is greenhouse


def test_find_adapter_returns_none_when_no_match(monkeypatch):
    monkeypatch.setattr(registry, 'ADAPTER_REGISTRY', [_WorkdayStub()])

    assert registry.find_adapter('https://example.com/careers') is None


def test_find_adapter_returns_first_match_in_order(monkeypatch):
    workday = _WorkdayStub()
    catch_all = _GreenhouseStub()
    catch_all.can_handle = lambda url: True
    monkeypatch.setattr(registry, 'ADAPTER_REGISTRY', [workday, catch_all])

    assert registry.find_adapter('https://example.com/careers') is catch_all
