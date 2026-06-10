"""
Generic career page spider for extracting jobs from company career pages.

This spider is designed to work with any company career page that uses common
HTML patterns for job listings. It tries multiple CSS selectors in order to
find job containers, making it adaptable to various site layouts.

Target URLs: https://company.com/careers, https://company.com/jobs, etc.

The spider can be initialized with specific company names and URLs:
    GenericCareerPageSpider(urls=['https://example.com/careers'], company_name='Example Corp')
"""

import sys
import os

_crawler_root = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)
if _crawler_root not in sys.path:
    sys.path.insert(0, _crawler_root)

from job_crawler.spiders.base_spider import BaseJobSpider
from logger import get_logger

log = get_logger(__name__)


class GenericCareerPageSpider(BaseJobSpider):
    """Spider for generic company career pages."""

    name = "generic_career_spider"

    # Common CSS patterns used across different job board sites and career pages.
    # Ordered from most to least specific — base spider tries each in order.
    container_selectors = [
        "div.job-listing",
        "div.job-card",
        "div.job",
        "article.job-posting",
        "li.job-item",
        "div[data-job-id]",
        "tr[data-job-id]",
        "div[class*='job-listing']",
        "div[class*='job-card']",
        "li[class*='job']",
        "article[class*='job']",
        "section.job-item",
        "div.position",
        "div.opening",
    ]

    def __init__(self, urls=None, company_name=None, keywords=None, *args, **kwargs):
        """
        Initialize the generic career page spider.

        Args:
            urls: List of career page URLs to scrape.
            company_name: Optional company name to use if not found in page HTML.
            keywords: Optional search keywords (for future filtering).
        """
        super().__init__(urls=urls, keywords=keywords, *args, **kwargs)
        self.company_name = company_name or "Unknown Company"

    def parse_job_item(self, container, response) -> dict | None:
        """
        Extract job fields from a job listing container.

        Tries multiple CSS selectors for each field to handle different HTML structures.

        Args:
            container: A Scrapy Selector for one job listing element.
            response: The full page response.

        Returns:
            A dict with job fields, or None if required fields are missing.
        """
        # Extract job title from multiple possible selectors
        title = self._safe_get(
            container,
            "h1[class*='title']::text",
            "h2[class*='title']::text",
            "h3[class*='title']::text",
            "a[data-job-title]::text",
            "span.job-title::text",
            "a[class*='job-title']::text",
            "h2::text",
            "h3::text",
            "a.title::text",
            "[class*='title']::text",
        )

        # Extract company name from page or use provided fallback
        company = self._safe_get(
            container,
            "span.company::text",
            "span[class*='company']::text",
            "[data-company]::text",
            "a[class*='company']::text",
        )
        if not company:
            company = self.company_name

        # Extract job URL from multiple possible locations
        raw_url = self._safe_get(
            container,
            "a[href][class*='job']::attr(href)",
            "a[data-job-url]::attr(href)",
            "a[href]::attr(href)",
            "[data-job-url]::attr(data-job-url)",
            "button[data-url]::attr(data-url)",
        )

        # Extract location from multiple possible selectors
        location = self._safe_get(
            container,
            "span.location::text",
            "span[class*='location']::text",
            "[data-location]::text",
            "span[class*='city']::text",
            "[class*='location']::text",
        )

        # Extract job description from multiple possible locations
        # Try to get all text nodes from common description containers
        description = self._safe_get_all(
            container,
            "div[class*='description'] p::text",
            "div.description::text",
            "div[class*='summary']::text",
            "div[class*='snippet']::text",
            "p::text",
            "ul li::text",
            "div.details::text",
        )

        # Extract salary from multiple possible selectors
        salary = self._safe_get(
            container,
            "span.salary::text",
            "span[class*='salary']::text",
            "[data-salary]::text",
            "span[class*='compensation']::text",
            "[class*='salary']::text",
        )

        # Return None if required fields are missing
        if not title or not company:
            return None

        # Convert relative URLs to absolute
        job_url = self._make_absolute_url(raw_url, response) if raw_url else ""

        return {
            "title": title,
            "company": company,
            "description": description or f"Job opening: {title} at {company}. Visit the career page for full details.",
            "url": job_url or response.url,
            "location": location or "Not specified",
            "salary": salary or None,
            "source_url": response.url,
        }
