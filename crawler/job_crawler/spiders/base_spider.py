"""
Abstract base spider for all job board extractors.

Subclasses must:
  1. Set ``name`` (Scrapy requirement)
  2. Set ``container_selectors`` — CSS selectors tried in order to find job cards
  3. Implement ``parse_job_item(container, response)`` returning a dict or None

The base ``parse()`` method handles container discovery, iteration, item population,
and error logging so subclasses only contain site-specific extraction logic.
"""

import logging
import sys
import os
from abc import abstractmethod
from urllib.parse import urljoin, urlparse

import scrapy
from job_crawler.items import JobItem

_crawler_root = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)
if _crawler_root not in sys.path:
    sys.path.insert(0, _crawler_root)

from logger import get_logger  # noqa: E402

log = get_logger(__name__)


class BaseJobSpider(scrapy.Spider):
    """
    Abstract base spider — do not use directly.

    Concrete subclasses declare:
        name             = 'spider_name'        (required by Scrapy)
        container_selectors = ['div.card', ...]  (tried in order)

    And implement:
        parse_job_item(container, response) -> dict | None
    """

    # Subclasses override with ordered list of CSS selectors for job containers.
    container_selectors: list[str] = []

    def __init__(self, urls=None, keywords=None, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.urls = urls or []
        self.keywords = keywords or []
        self.start_urls = self.urls

    @abstractmethod
    def parse_job_item(self, container, response) -> dict | None:
        """
        Extract a single job's fields from a container selector element.

        Args:
            container: A Scrapy Selector for one job card element.
            response:  The full page response (for URL resolution, fallback selectors).

        Returns:
            A dict with keys matching JobItem fields, or None to skip this container.
            Required keys: title, company, description, url, location, source_url.
            Optional keys: salary.
        """

    def parse(self, response):
        """
        Iterate job containers on the page and yield populated JobItems.

        Tries each selector in ``container_selectors`` in order.  Uses the first
        one that returns at least one element.  If none match, logs a warning and
        returns without yielding.
        """
        containers = []
        matched_selector = None

        for selector in self.container_selectors:
            containers = response.css(selector)
            if containers:
                matched_selector = selector
                break

        if not containers:
            log.warning(
                "No job containers found on page",
                extra={
                    "url": response.url,
                    "spider": self.name,
                    "tried_selectors": self.container_selectors,
                },
            )
            return

        log.info(
            "Job containers found",
            extra={
                "url": response.url,
                "spider": self.name,
                "selector": matched_selector,
                "count": len(containers),
            },
        )

        for container in containers:
            try:
                data = self.parse_job_item(container, response)
            except Exception as exc:
                log.warning(
                    "parse_job_item raised an exception; skipping container",
                    extra={
                        "url": response.url,
                        "spider": self.name,
                        "error": str(exc),
                    },
                )
                continue

            if data is None:
                continue

            if not self._has_required_fields(data):
                log.debug(
                    "Container missing required fields; skipping",
                    extra={
                        "url": response.url,
                        "spider": self.name,
                        "title": data.get("title", ""),
                        "company": data.get("company", ""),
                    },
                )
                continue

            item = JobItem()
            for field in item.fields:
                if field in data:
                    item[field] = data[field]
            yield item

    # -----------------------------------------------------------------------
    # Helpers available to all subclasses
    # -----------------------------------------------------------------------

    def _safe_get(self, selector, *css_selectors: str) -> str:
        """
        Try each CSS selector in turn, return the first non-empty stripped text.

        Args:
            selector:      A Scrapy Selector (container element or full response).
            *css_selectors: One or more CSS selector strings, tried left-to-right.

        Returns:
            Stripped text of the first matching selector, or '' if none match.
        """
        for css in css_selectors:
            value = selector.css(css).get("") or ""
            value = value.strip()
            if value:
                return value
        return ""

    def _safe_get_all(self, selector, *css_selectors: str) -> str:
        """
        Try each CSS selector, join all matched texts into one string.

        Useful for description fields composed of multiple <li> or <p> elements.

        Returns:
            Single space-joined string of all matched text nodes, or ''.
        """
        for css in css_selectors:
            values = [v.strip() for v in selector.css(css).getall() if v.strip()]
            if values:
                return " ".join(values)
        return ""

    def _make_absolute_url(self, url: str, response) -> str:
        """
        Convert a relative or protocol-relative URL to an absolute HTTPS URL.

        - '/jobs/123'    → 'https://site.com/jobs/123'
        - '//site.com/j' → 'https://site.com/j'
        - 'https://...'  → unchanged

        Args:
            url:      Raw href value extracted from a selector.
            response: Current Scrapy response (provides base URL).

        Returns:
            Absolute HTTPS URL string, or '' if the input was empty.
        """
        if not url:
            return ""
        url = url.strip()
        if url.startswith("//"):
            return "https:" + url
        if url.startswith("http://"):
            return "https://" + url[7:]
        if not url.startswith("https://"):
            return urljoin(response.url, url)
        return url

    def _has_required_fields(self, data: dict) -> bool:
        """
        Return True if data contains non-empty title and company strings.

        Mirrors the validation in ``job_crawler.pipelines.JobPipeline`` and
        ``models.JobData`` so invalid items are dropped before pipeline overhead.
        """
        title = (data.get("title") or "").strip()
        company = (data.get("company") or "").strip()
        return bool(title) and bool(company)
