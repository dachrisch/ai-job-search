"""
LinkedIn job board spider.

Target URL: https://www.linkedin.com/jobs/search?keywords=<keywords>

Extraction strategy:
  1. Attempt JSON extraction from embedded <code> tags (LinkedIn's server-side data)
  2. Fall back to CSS selectors on the rendered HTML

LinkedIn frequently returns 403 for unauthenticated scraping.  The spider logs
a warning and yields nothing in that case — Phase 3 circuit breaker handles
propagating the failure state.
"""

import json
import re
import sys
import os
from urllib.parse import quote_plus

import scrapy

_crawler_root = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)
if _crawler_root not in sys.path:
    sys.path.insert(0, _crawler_root)

from job_crawler.spiders.base_spider import BaseJobSpider
from logger import get_logger

log = get_logger(__name__)


class LinkedInSpider(BaseJobSpider):
    """Spider for linkedin.com/jobs."""

    name = "linkedin_spider"

    container_selectors = [
        "ul.jobs-search__results-list li",
        "div.base-card",
        "li.jobs-search-results__list-item",
        "div[data-entity-urn]",
    ]

    def __init__(self, urls=None, keywords=None, *args, **kwargs):
        super().__init__(urls=urls, keywords=keywords, *args, **kwargs)
        # Build keyword-aware start URLs if only bare domains were passed
        if self.keywords and self.start_urls:
            enriched = []
            for url in self.start_urls:
                if "linkedin.com" in url and "keywords" not in url:
                    kw_encoded = quote_plus(self.keywords)
                    url = f"https://www.linkedin.com/jobs/search?keywords={kw_encoded}"
                enriched.append(url)
            self.start_urls = enriched

    def parse(self, response):
        """Try JSON extraction first, fall back to CSS-based base parse."""
        # Attempt JSON extraction from embedded data
        json_items = list(self._parse_json_jobs(response))
        if json_items:
            log.info(
                "LinkedIn: extracted jobs from embedded JSON",
                extra={"url": response.url, "count": len(json_items)},
            )
            yield from json_items
            return

        # Check for 403 before attempting CSS
        if response.status == 403:
            log.warning(
                "LinkedIn returned 403; login required; skipping",
                extra={"url": response.url},
            )
            return

        # Fall back to CSS extraction via base class
        log.info(
            "LinkedIn: falling back to CSS extraction",
            extra={"url": response.url},
        )
        yield from super().parse(response)

    def _parse_json_jobs(self, response):
        """
        Extract job listings from LinkedIn's embedded JSON data.

        LinkedIn embeds job data in <code> tags or <script type="application/json">
        blocks as part of its server-side rendering.  This is more reliable than
        CSS selectors since class names change frequently.

        Yields JobItem instances.  Silently returns on any parse error so the
        CSS fallback path is always tried.
        """
        from job_crawler.items import JobItem

        # LinkedIn embeds data in <code> elements with specific IDs
        code_contents = response.css("code[id]::text").getall()
        code_contents += response.css("script[type='application/json']::text").getall()

        for content in code_contents:
            try:
                data = json.loads(content)
            except (json.JSONDecodeError, ValueError):
                continue

            # Navigate LinkedIn's nested data structure
            included = data.get("included", [])
            if not included:
                # Try alternative structure
                elements = data.get("data", {}).get("jobsDashJobCardsByJobCollection", {})
                elements = elements.get("elements", [])
                included = elements

            for entry in included:
                if not isinstance(entry, dict):
                    continue

                # LinkedIn uses $type to identify entity types
                entity_type = entry.get("$type", "") or entry.get("entityType", "")
                if "JobPosting" not in entity_type and "jobCard" not in entity_type.lower():
                    # Try treating any dict with title+company as a job
                    if not (entry.get("title") and entry.get("companyName")):
                        continue

                title = (entry.get("title") or "").strip()
                company = (entry.get("companyName") or entry.get("company", {}).get("name", "") or "").strip()
                job_url = (entry.get("jobPostingUrl") or entry.get("url") or "").strip()
                location = (entry.get("formattedLocation") or entry.get("location") or "").strip()
                description = (entry.get("description", {}) or {})
                if isinstance(description, dict):
                    description = (description.get("text") or "").strip()
                else:
                    description = str(description).strip()

                if not title or not company:
                    continue

                job_url = self._make_absolute_url(job_url, response)
                if not job_url:
                    job_url = response.url

                item = JobItem()
                item["title"] = title
                item["company"] = company
                item["description"] = description or f"Job posting for {title} at {company}"
                item["url"] = job_url
                item["location"] = location or "Not specified"
                item["salary"] = (entry.get("salary") or entry.get("salaryInsights") or "").strip() or None
                item["source_url"] = response.url
                yield item

    def parse_job_item(self, container, response) -> dict | None:
        """Extract job fields from a LinkedIn search result card element."""
        title = self._safe_get(
            container,
            ".base-search-card__title::text",
            "h3.base-search-card__title::text",
            "h3::text",
            "a[data-tracking-control-name]::attr(aria-label)",
        )
        company = self._safe_get(
            container,
            ".base-search-card__subtitle a::text",
            ".base-search-card__subtitle::text",
            "h4.base-search-card__subtitle::text",
            "a.hidden-nested-link::text",
        )
        raw_url = self._safe_get(
            container,
            "a.base-card__full-link::attr(href)",
            ".base-card__full-link::attr(href)",
            "a[data-tracking-control-name]::attr(href)",
            "a::attr(href)",
        )
        location = self._safe_get(
            container,
            ".job-search-card__location::text",
            "span.job-search-card__location::text",
            ".base-search-card__metadata span.job-search-card__location::text",
        )
        description = self._safe_get_all(
            container,
            ".job-search-card__snippet::text",
            ".base-search-card__snippet::text",
            "p::text",
        )
        salary = self._safe_get(
            container,
            ".job-search-card__salary-info::text",
            ".base-search-card__salary::text",
        )

        if not title or not company:
            return None

        job_url = self._make_absolute_url(raw_url, response)

        return {
            "title": title,
            "company": company,
            "description": description or f"Job posting for {title} at {company}. See full listing for details.",
            "url": job_url or response.url,
            "location": location or "Not specified",
            "salary": salary or None,
            "source_url": response.url,
        }
