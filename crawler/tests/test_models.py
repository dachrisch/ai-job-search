import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from models import CompanyCrawlResult, scrapy_item_to_job_data


def _item(**overrides):
    item = {
        'title': 'Senior Product Manager',
        'company': 'IDnow',
        'description': 'A long enough description for validation to accept it.',
        'url': 'https://job-boards.eu.greenhouse.io/idnow/jobs/4999299101',
        'source_url': 'https://job-boards.eu.greenhouse.io/idnow',
        'location': 'Munich',
        'salary': None,
    }
    item.update(overrides)
    return item


def test_job_data_accepts_http_source_url():
    # Discovery hands over http:// boards; rejecting their jobs made the crawler
    # silently fall back to the generic spider on an https-only page check.
    job = scrapy_item_to_job_data(_item(source_url='http://job-boards.eu.greenhouse.io/idnow'))
    assert job is not None
    assert job.source_url == 'http://job-boards.eu.greenhouse.io/idnow'


def test_job_data_accepts_http_job_url():
    job = scrapy_item_to_job_data(_item(url='http://job-boards.eu.greenhouse.io/idnow/jobs/1'))
    assert job is not None


def test_job_data_rejects_non_http_url():
    assert scrapy_item_to_job_data(_item(url='ftp://example.com/job/1')) is None



def test_company_crawl_result_defaults():
    result = CompanyCrawlResult(search_id='s1', company_id='c1')
    assert result.jobs == []
    assert result.unsupported is False


def test_company_crawl_result_unsupported_true():
    result = CompanyCrawlResult(search_id='s1', company_id='c1', unsupported=True)
    assert result.unsupported is True
    d = result.model_dump(by_alias=True)
    assert d['unsupported'] is True
