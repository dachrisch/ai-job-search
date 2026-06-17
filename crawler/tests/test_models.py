import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from models import CompanyCrawlResult


def test_company_crawl_result_defaults():
    result = CompanyCrawlResult(search_id='s1', company_id='c1')
    assert result.jobs == []
    assert result.unsupported is False


def test_company_crawl_result_unsupported_true():
    result = CompanyCrawlResult(search_id='s1', company_id='c1', unsupported=True)
    assert result.unsupported is True
    d = result.model_dump(by_alias=True)
    assert d['unsupported'] is True
