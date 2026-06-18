"""Tests for generic spider false positive fixes.

Covers two known regression cases from the 2026-06-17 site survey:
  1. Monster.de — CTA element matched as a job because it had no job-specific URL
                  (its href was the page URL itself, or missing entirely).
  2. Trivago    — one real job appeared twice because two container elements
                  in the HTML pointed to the same job detail URL.
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import pytest
from scrapy.http import HtmlResponse

from job_crawler.spiders.generic_career_spider import GenericCareerPageSpider


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_response(html: str, url: str = 'https://example.com/careers') -> HtmlResponse:
    return HtmlResponse(url=url, body=html.encode(), encoding='utf-8')


def spider(company_name: str = 'ACME') -> GenericCareerPageSpider:
    return GenericCareerPageSpider(company_name=company_name)


# ---------------------------------------------------------------------------
# Fix 1: reject items where job URL == source URL (CTA / "no link" case)
# ---------------------------------------------------------------------------

CTA_HTML = """
<html><body>
  <div class="job-card">
    <h2>Upload your CV</h2>
    <a href="/careers">Get started</a>
  </div>
</body></html>
"""

REAL_JOB_HTML = """
<html><body>
  <div class="job-card">
    <h2>Senior Python Engineer</h2>
    <a href="/careers/jobs/42">Apply now</a>
  </div>
</body></html>
"""


def test_job_whose_link_points_to_the_current_page_is_rejected():
    """A container whose href resolves to the page URL must be dropped (Monster.de CTA pattern)."""
    sp = spider()
    resp = make_response(CTA_HTML, url='https://example.com/careers')
    items = list(sp.parse(resp))
    assert items == [], f"Expected no items but got {items}"


def test_job_whose_link_points_to_a_detail_page_is_kept():
    """A container with a proper job-detail href must not be dropped."""
    sp = spider()
    resp = make_response(REAL_JOB_HTML, url='https://example.com/careers')
    items = list(sp.parse(resp))
    assert len(items) == 1
    assert items[0]['url'] == 'https://example.com/careers/jobs/42'


def test_job_with_no_href_at_all_is_rejected():
    """A container with no anchor tag at all has url == source_url and must be dropped."""
    html = """
    <html><body>
      <div class="job-card">
        <h2>Something suspicious</h2>
        <span>No link here</span>
      </div>
    </body></html>
    """
    sp = spider()
    items = list(sp.parse(make_response(html)))
    assert items == []


# ---------------------------------------------------------------------------
# Fix 2: URL-based deduplication (Trivago duplicate pattern)
# ---------------------------------------------------------------------------

DUPLICATE_JOB_HTML = """
<html><body>
  <div class="job-card">
    <h2>Backend Engineer</h2>
    <a href="/careers/jobs/99">Apply</a>
  </div>
  <div class="job-card">
    <h2>Backend Engineer</h2>
    <a href="/careers/jobs/99">Apply</a>
  </div>
</body></html>
"""

TWO_DISTINCT_JOBS_HTML = """
<html><body>
  <div class="job-card">
    <h2>Backend Engineer</h2>
    <a href="/careers/jobs/1">Apply</a>
  </div>
  <div class="job-card">
    <h2>Frontend Engineer</h2>
    <a href="/careers/jobs/2">Apply</a>
  </div>
</body></html>
"""


def test_duplicate_job_urls_are_deduplicated():
    """The same job container appearing twice must yield only one item (Trivago pattern)."""
    sp = spider()
    resp = make_response(DUPLICATE_JOB_HTML, url='https://example.com/careers')
    items = list(sp.parse(resp))
    assert len(items) == 1, f"Expected 1 item but got {len(items)}: {items}"
    assert items[0]['url'] == 'https://example.com/careers/jobs/99'


def test_two_different_jobs_are_both_kept():
    """Two containers with distinct URLs must both be yielded."""
    sp = spider()
    resp = make_response(TWO_DISTINCT_JOBS_HTML, url='https://example.com/careers')
    items = list(sp.parse(resp))
    assert len(items) == 2
    urls = {item['url'] for item in items}
    assert urls == {
        'https://example.com/careers/jobs/1',
        'https://example.com/careers/jobs/2',
    }
