"""Adapter for the Python.org jobs board (https://www.python.org/jobs/)."""

from __future__ import annotations

import re
import requests
from bs4 import BeautifulSoup

from job_crawler.adapters.base import CareerSiteAdapter, AuthContext, RawPage, JobDict, USER_AGENT

_BASE = 'https://www.python.org'
_JOBS_URL = f'{_BASE}/jobs/'


class PythonJobsAdapter(CareerSiteAdapter):
    """Scrapes the Python.org jobs board via its server-rendered HTML listing."""

    def can_handle(self, url: str) -> bool:
        return 'python.org/jobs' in url

    def fetch_page(self, url: str, keywords: str, auth_context: AuthContext, page_token: str | None) -> RawPage:
        params = {'page': page_token} if page_token else {}
        response = requests.get(
            _JOBS_URL,
            params=params,
            headers={'User-Agent': USER_AGENT},
            timeout=30,
        )
        response.raise_for_status()
        return {'html': response.text}

    def parse_jobs(self, raw_page: RawPage) -> tuple[list[JobDict], str | None]:
        soup = BeautifulSoup(raw_page['html'], 'html.parser')
        jobs: list[JobDict] = []

        for li in soup.select('ol.list-recent-jobs li'):
            title_el = li.select_one('span.listing-company-name a')
            if not title_el:
                continue

            title = title_el.get_text(strip=True)
            job_url = _BASE + title_el['href']

            # Company name: all text nodes in the span except the title link and "New" badge
            company_span = li.select_one('span.listing-company-name')
            company_parts = [
                s for s in company_span.stripped_strings
                if s != title and s != 'New'
            ]
            company = ' '.join(company_parts).strip()

            location_el = li.select_one('span.listing-location')
            location = location_el.get_text(strip=True) if location_el else 'Remote'

            job_type_el = li.select_one('span.listing-job-type')
            job_type = ', '.join(a.get_text(strip=True) for a in job_type_el.select('a')) if job_type_el else ''

            description = f'{title} at {company}. Location: {location}. Type: {job_type} | python.org/jobs'

            jobs.append({
                'title': title,
                'company': company,
                'description': description,
                'url': job_url,
                'location': location,
                'source_url': _JOBS_URL,
            })

        next_token: str | None = None
        next_el = soup.select_one('li.next a')
        if next_el and next_el.get('href'):
            m = re.search(r'page=(\d+)', next_el['href'])
            if m:
                next_token = m.group(1)

        return jobs, next_token
