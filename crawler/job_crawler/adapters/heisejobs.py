"""Adapter for the Heise Jobs board (jobs.heise.de)."""

from __future__ import annotations

import requests
from bs4 import BeautifulSoup

from job_crawler.adapters.base import CareerSiteAdapter, AuthContext, RawPage, JobDict, USER_AGENT

_BASE = 'https://jobs.heise.de'
_SEARCH_URL = f'{_BASE}/search'


class HeiseJobsAdapter(CareerSiteAdapter):
    """Scrapes the Heise Jobs board via its server-rendered search results page."""

    def can_handle(self, url: str) -> bool:
        return 'jobs.heise.de' in url

    def fetch_page(
        self, url: str, keywords: str, auth_context: AuthContext, page_token: str | None
    ) -> RawPage:
        response = requests.get(
            _SEARCH_URL,
            params={'q': keywords or ''},
            headers={'User-Agent': USER_AGENT},
            timeout=30,
        )
        response.raise_for_status()
        return {'html': response.text, 'source_url': response.url}

    def parse_jobs(self, raw_page: RawPage) -> tuple[list[JobDict], str | None]:
        soup = BeautifulSoup(raw_page['html'], 'html.parser')
        source_url = raw_page['source_url']
        jobs: list[JobDict] = []

        for li in soup.select('li[data-testid^="joblist-job-"]'):
            job_id = li.get('data-id')
            if not job_id:
                continue

            h2 = li.find('h2')
            if not h2:
                continue

            badge = h2.find('span', attrs={'data-testid': 'top-badge'})
            if badge:
                badge.decompose()
            title = h2.get_text(strip=True)

            job_url = f'{_BASE}/job?id={job_id}'

            img = li.find('img')
            company = ''
            if img:
                alt = img.get('alt', '')
                if alt.startswith('Logo: '):
                    company = alt[6:].strip()

            location = ''
            loc_div = li.select_one('div.loc')
            if loc_div:
                loc_span = loc_div.find('span')
                if loc_span:
                    location = loc_span.get_text(strip=True)

            description = f'{title} at {company}. Location: {location} | {source_url} | jobs.heise.de'

            jobs.append({
                'title': title,
                'company': company,
                'description': description,
                'url': job_url,
                'location': location,
                'source_url': source_url,
            })

        return jobs, None
