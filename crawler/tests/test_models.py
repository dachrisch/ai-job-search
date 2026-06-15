import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import pytest
from models import CapturedRequest, CompanyCrawlResult


def test_captured_request_snake_case():
    r = CapturedRequest(url='https://x.com', method='GET', response_body='[]', response_status=200)
    assert r.url == 'https://x.com'
    assert r.response_body == '[]'


def test_captured_request_camel_alias():
    r = CapturedRequest.model_validate({
        'url': 'https://x.com',
        'method': 'GET',
        'responseBody': '[]',
        'responseStatus': 200,
    })
    assert r.response_body == '[]'
    assert r.response_status == 200


def test_captured_request_serialises_camel():
    r = CapturedRequest(url='https://x.com', method='GET', response_body='{}', response_status=200)
    d = r.model_dump(by_alias=True)
    assert 'responseBody' in d
    assert 'responseStatus' in d


def test_company_crawl_result_defaults():
    result = CompanyCrawlResult(search_id='s1', company_id='c1')
    assert result.network_capture == []
    assert result.needs_discovery is False


def test_company_crawl_result_with_capture():
    capture = [CapturedRequest(url='https://x.com/api', method='GET', response_body='[]', response_status=200)]
    result = CompanyCrawlResult(search_id='s1', company_id='c1', network_capture=capture, needs_discovery=True)
    assert len(result.network_capture) == 1
    assert result.needs_discovery is True
    d = result.model_dump(by_alias=True)
    assert 'networkCapture' in d
    assert 'needsDiscovery' in d
