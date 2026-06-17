"""
Base class for career-site adapters.

Adapters implement four lifecycle hooks so the crawler can fetch job
listings directly from a known ATS platform's API instead of relying on
the generic Scrapy spider. See registry.py for how adapters are matched
to a URL, and cli.py's _try_adapter() for how the crawler invokes them.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

AuthContext = dict[str, Any]
RawPage = dict[str, Any]
JobDict = dict[str, Any]

MAX_PAGES = 10


class CareerSiteAdapter(ABC):
    """Fetches job listings from a specific ATS platform's API."""

    @abstractmethod
    def can_handle(self, url: str) -> bool:
        """Return True if this adapter knows how to fetch jobs from url."""
        raise NotImplementedError

    def authenticate(self, url: str) -> AuthContext:
        """Acquire any session/token/cookie needed before fetching. Default: none."""
        return {}

    @abstractmethod
    def fetch_page(
        self, url: str, keywords: str, auth_context: AuthContext, page_token: str | None
    ) -> RawPage:
        """Perform one HTTP request and return the raw response."""
        raise NotImplementedError

    @abstractmethod
    def parse_jobs(self, raw_page: RawPage) -> tuple[list[JobDict], str | None]:
        """Extract job dicts and an optional next-page token from one raw page."""
        raise NotImplementedError

    def run(self, url: str, keywords: str) -> list[JobDict]:
        """Drive authenticate -> fetch_page/parse_jobs loop, capped at MAX_PAGES."""
        auth_context = self.authenticate(url)
        jobs: list[JobDict] = []
        page_token: str | None = None

        for _ in range(MAX_PAGES):
            raw_page = self.fetch_page(url, keywords, auth_context, page_token)
            page_jobs, page_token = self.parse_jobs(raw_page)
            jobs.extend(page_jobs)
            if not page_token:
                break

        return jobs
