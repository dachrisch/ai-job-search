"""
Indeed job board spider.

Target URL: https://www.indeed.com/jobs?q=<keywords>

Indeed uses server-side rendered HTML with fairly stable class names.
The main risk is aggressive rate limiting (429), which Phase 3's RateLimiter
and CircuitBreaker handle at the CLI level.
"""

import sys
import os
from urllib.parse import quote_plus, urljoin

_crawler_root = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)
if _crawler_root not in sys.path:
    sys.path.insert(0, _crawler_root)

from job_crawler.spiders.base_spider import BaseJobSpider
from logger import get_logger

log = get_logger(__name__)

# Indeed's base URL for resolving relative job links
_INDEED_BASE = "https://www.indeed.com"


class IndeedSpider(BaseJobSpider):
    """Spider for indeed.com/jobs."""

    name = "indeed_spider"

    container_selectors = [
        "div.resultContent",
        "div[data-testid='slider_item']",
        "td.resultContent",
        "div.job_seen_beacon",
        "li.css-5lfssm",
    ]

    def __init__(self, urls=None, keywords=None, *args, **kwargs):
        super().__init__(urls=urls, keywords=keywords, *args, **kwargs)
        if self.keywords and self.start_urls:
            enriched = []
            for url in self.start_urls:
                if "indeed.com" in url and "?" not in url:
                    kw_encoded = quote_plus(self.keywords)
                    url = f"https://www.indeed.com/jobs?q={kw_encoded}"
                enriched.append(url)
            self.start_urls = enriched

    def parse_job_item(self, container, response) -> dict | None:
        """Extract job fields from an Indeed search result card."""
        title = self._safe_get(
            container,
            "h2.jobTitle span[title]::attr(title)",
            "h2.jobTitle span::text",
            "h2.jobTitle a::attr(title)",
            "a.jcs-JobTitle::attr(title)",
            "span[id^='jobTitle']::text",
        )
        company = self._safe_get(
            container,
            "span.companyName::text",
            "a[data-testid='company-name']::text",
            "span[data-testid='company-name']::text",
            "div.company_location span.companyName::text",
        )
        raw_url = self._safe_get(
            container,
            "h2.jobTitle a::attr(href)",
            "a.jcs-JobTitle::attr(href)",
            "a[data-testid='job-title-link']::attr(href)",
            "a::attr(href)",
        )
        location = self._safe_get(
            container,
            "div.companyLocation::text",
            "[data-testid='job-location']::text",
            "div[data-testid='text-location']::text",
            "span.location::text",
        )
        # Indeed job summaries can be a list of <li> items or a single snippet
        description = self._safe_get_all(
            container,
            ".job-snippet ul li::text",
            "ul.css-1g90gv6 li::text",
            "div.job-snippet::text",
            "div.summary li::text",
            ".jobCardShelfContainer::text",
        )
        salary = self._safe_get(
            container,
            "div.salary-snippet-container::text",
            ".attribute_snippet::text",
            "div[data-testid='attribute_snippet_testid']::text",
            "span.salaryText::text",
        )

        # Filter out non-salary text from salary field
        if salary and not any(c in salary for c in ("$", "€", "£", "per", "hour", "year", "k")):
            salary = None

        if not title or not company:
            return None

        # Indeed job links: relative paths need indeed.com prefix
        if raw_url and raw_url.startswith("/"):
            job_url = _INDEED_BASE + raw_url
        else:
            job_url = self._make_absolute_url(raw_url, response)

        return {
            "title": title,
            "company": company,
            "description": description or f"Job opening: {title} at {company}. Visit Indeed for full job description.",
            "url": job_url or response.url,
            "location": location or "Not specified",
            "salary": salary or None,
            "source_url": response.url,
        }
