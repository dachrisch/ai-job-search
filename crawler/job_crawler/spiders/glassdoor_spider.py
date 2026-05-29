"""
Glassdoor job board spider.

Target URL: https://www.glassdoor.com/Job/jobs.htm?sc.keyword=<keywords>

Glassdoor is heavily JavaScript-rendered.  These CSS selectors target the
server-side HTML that Glassdoor still sends in the initial response.  If
they match nothing (full JS rendering required), the base parse() logs a
warning and returns — the circuit breaker records the miss.

Salary information is more commonly present on Glassdoor than LinkedIn.
"""

import sys
import os
from urllib.parse import quote_plus

_crawler_root = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)
if _crawler_root not in sys.path:
    sys.path.insert(0, _crawler_root)

from job_crawler.spiders.base_spider import BaseJobSpider
from logger import get_logger

log = get_logger(__name__)


class GlassdoorSpider(BaseJobSpider):
    """Spider for glassdoor.com jobs."""

    name = "glassdoor_spider"

    container_selectors = [
        "li[data-test='jobListing']",
        "li.react-job-listing",
        "div.jobCard",
        "article.JobCard",
        "li[class*='JobsList_jobListItem']",
        "div[class*='jobCard']",
    ]

    def __init__(self, urls=None, keywords=None, *args, **kwargs):
        super().__init__(urls=urls, keywords=keywords, *args, **kwargs)
        if self.keywords and self.start_urls:
            enriched = []
            for url in self.start_urls:
                if "glassdoor.com" in url and "keyword" not in url:
                    kw_encoded = quote_plus(self.keywords)
                    url = f"https://www.glassdoor.com/Job/jobs.htm?sc.keyword={kw_encoded}"
                enriched.append(url)
            self.start_urls = enriched

    def parse(self, response):
        """Wrap base parse with JS-rendering fallback warning."""
        if response.status in (403, 429):
            log.warning(
                "Glassdoor blocked request",
                extra={"url": response.url, "status": response.status},
            )
            return
        yield from super().parse(response)

    def parse_job_item(self, container, response) -> dict | None:
        """Extract job fields from a Glassdoor job card element."""
        title = self._safe_get(
            container,
            "a[data-test='job-title']::text",
            "[class*='JobCard_jobTitle']::text",
            "[class*='jobTitle']::text",
            "a.jobLink::text",
            "a[class*='job-title']::text",
        )
        company = self._safe_get(
            container,
            "div[data-test='employer-name']::text",
            "[class*='EmployerProfile_profileContainer'] span::text",
            "[class*='JobCard_employerName']::text",
            "div.employerName::text",
            "a.employerName::text",
        )
        raw_url = self._safe_get(
            container,
            "a[data-test='job-title']::attr(href)",
            "a.jobLink::attr(href)",
            "[class*='JobCard_trackingLink']::attr(href)",
            "a[class*='job-title']::attr(href)",
            "a::attr(href)",
        )
        location = self._safe_get(
            container,
            "div[data-test='emp-location']::text",
            "[class*='JobCard_location']::text",
            "span.location::text",
            "div.location::text",
        )
        description = self._safe_get_all(
            container,
            "[class*='JobCard_jobDescriptionSnippet']::text",
            "p.desc::text",
            "div.job-description p::text",
            "div[class*='description']::text",
        )
        salary = self._safe_get(
            container,
            "div[data-test='detailSalary']::text",
            "[class*='JobCard_salaryEstimate']::text",
            "span[class*='salary']::text",
            "div[class*='salary']::text",
        )

        if not title or not company:
            return None

        job_url = self._make_absolute_url(raw_url, response)

        # Glassdoor relative URLs are like /job-listing/title-company-JV_IC123_KO0,10.htm
        # These are correctly handled by _make_absolute_url via urljoin

        return {
            "title": title,
            "company": company,
            "description": description or f"Position: {title} at {company}. See full details on Glassdoor.",
            "url": job_url or response.url,
            "location": location or "Not specified",
            "salary": salary or None,
            "source_url": response.url,
        }
