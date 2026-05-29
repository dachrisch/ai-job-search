"""
Generic job board spider — fallback for unknown sites.

Used when no site-specific spider matches the target domain.
Tries common CSS selector patterns found across many job boards.
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


class GenericJobSpider(BaseJobSpider):
    """
    Fallback spider for job boards without a dedicated extractor.

    Tries a broad set of common CSS patterns used across many job listing sites.
    Results may be lower quality than site-specific spiders.
    """

    name = "generic_job_spider"

    container_selectors = [
        "div.job-listing",
        "div.job-item",
        "article.job",
        "li.job",
        "div[data-job]",
        "li[data-job]",
        "article[data-job]",
    ]

    def parse(self, response):
        """Log fallback usage then delegate to base parse."""
        log.warning(
            "Using generic spider fallback",
            extra={"url": response.url, "spider": self.name},
        )
        yield from super().parse(response)

    def parse_job_item(self, container, response) -> dict | None:
        """Extract job fields using generic cross-site CSS patterns."""
        title = self._safe_get(
            container,
            "h2::text",
            "h3::text",
            ".job-title::text",
            ".title::text",
        )
        company = self._safe_get(
            container,
            ".company::text",
            ".employer::text",
            ".organization::text",
        )
        raw_url = self._safe_get(
            container,
            "a::attr(href)",
        )
        description = self._safe_get_all(
            container,
            ".job-description::text",
            ".description::text",
            "p::text",
        )
        salary = self._safe_get(
            container,
            ".salary::text",
            ".compensation::text",
        )
        location = self._safe_get(
            container,
            ".location::text",
            ".job-location::text",
        )

        if not title or not company:
            return None

        job_url = self._make_absolute_url(raw_url, response)

        return {
            "title": title,
            "company": company,
            "description": description or f"Job opening: {title} at {company}.",
            "url": job_url or response.url,
            "location": location or "Not specified",
            "salary": salary or None,
            "source_url": response.url,
        }
