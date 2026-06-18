"""Adapter for the Django Foundation jobs board (djangoproject.com/foundation/jobs)."""

from __future__ import annotations

import requests
from bs4 import BeautifulSoup

from job_crawler.adapters.base import CareerSiteAdapter, AuthContext, RawPage, JobDict, USER_AGENT

_BASE = 'https://www.djangoproject.com'
_JOBS_URL = f'{_BASE}/foundation/jobs/'


class DjangoFoundationAdapter(CareerSiteAdapter):
    """Scrapes the Django Foundation jobs board via its server-rendered HTML listing."""

    def can_handle(self, url: str) -> bool:
        return 'djangoproject.com/foundation/jobs' in url

    def fetch_page(
        self, url: str, keywords: str, auth_context: AuthContext, page_token: str | None
    ) -> RawPage:
        response = requests.get(
            _JOBS_URL,
            headers={'User-Agent': USER_AGENT},
            timeout=30,
        )
        response.raise_for_status()
        return {'html': response.text, 'source_url': _JOBS_URL}

    def parse_jobs(self, raw_page: RawPage) -> tuple[list[JobDict], str | None]:
        soup = BeautifulSoup(raw_page['html'], 'html.parser')
        source_url = raw_page['source_url']
        jobs: list[JobDict] = []

        for li in soup.select('#job-list li'):
            heading = li.find('h2')
            if not heading:
                continue
            link = heading.find('a')
            if not link:
                continue

            title = link.get_text(strip=True)
            href = link.get('href', '')
            job_url = _BASE + href if href.startswith('/') else href

            meta_el = li.find('p', class_='job-meta')
            meta = meta_el.get_text(strip=True) if meta_el else ''
            parts = [p.strip() for p in meta.split('|')]
            company = parts[0] if len(parts) >= 1 else ''
            location = parts[1] if len(parts) >= 2 else ''

            description = f'{title} at {company}. Location: {location} | djangoproject.com/foundation/jobs'

            jobs.append({
                'title': title,
                'company': company,
                'description': description,
                'url': job_url,
                'location': location,
                'source_url': source_url,
            })

        return jobs, None
