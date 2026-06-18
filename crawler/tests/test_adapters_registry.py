import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from job_crawler.adapters.base import CareerSiteAdapter
from job_crawler.adapters import registry
from job_crawler.adapters.djangofoundation import DjangoFoundationAdapter
from job_crawler.adapters.greenhouse import GreenhouseAdapter
from job_crawler.adapters.heisejobs import HeiseJobsAdapter
from job_crawler.adapters.lever import LeverAdapter
from job_crawler.adapters.smartrecruiters import SmartRecruitersAdapter


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


def test_find_adapter_returns_greenhouse_for_greenhouse_url():
    adapter = registry.find_adapter('https://boards.greenhouse.io/stripe')
    assert isinstance(adapter, GreenhouseAdapter)


def test_find_adapter_returns_lever_for_lever_url():
    adapter = registry.find_adapter('https://jobs.lever.co/mozilla')
    assert isinstance(adapter, LeverAdapter)


def test_find_adapter_returns_smartrecruiters_for_sr_url():
    adapter = registry.find_adapter('https://careers.smartrecruiters.com/Docker')
    assert isinstance(adapter, SmartRecruitersAdapter)


def test_find_adapter_returns_djangofoundation_for_dsf_url():
    adapter = registry.find_adapter('https://www.djangoproject.com/foundation/jobs/')
    assert isinstance(adapter, DjangoFoundationAdapter)


def test_find_adapter_returns_heisejobs_for_heise_url():
    adapter = registry.find_adapter('https://jobs.heise.de/')
    assert isinstance(adapter, HeiseJobsAdapter)
