"""Adapter for the Heise Jobs board (jobs.heise.de)."""

from __future__ import annotations

import re

import requests
from bs4 import BeautifulSoup, NavigableString

from job_crawler.adapters.base import CareerSiteAdapter, AuthContext, RawPage, JobDict, USER_AGENT

_BASE = 'https://jobs.heise.de'
_JOBS_URL = f'{_BASE}/'


class HeiseJobsAdapter(CareerSiteAdapter):
    """Scrapes the Heise Jobs board via its server-rendered HTML listing."""

    def can_handle(self, url: str) -> bool:
        return 'jobs.heise.de' in url

    def fetch_page(
        self, url: str, keywords: str, auth_context: AuthContext, page_token: str | None
    ) -> RawPage:
        params = {'page': page_token} if page_token else {}
        response = requests.get(
            _JOBS_URL,
            params=params,
            headers={'User-Agent': USER_AGENT},
            timeout=30,
        )
        response.raise_for_status()
        return {'html': response.text, 'source_url': _JOBS_URL}

    def parse_jobs(self, raw_page: RawPage) -> tuple[list[JobDict], str | None]:
        soup = BeautifulSoup(raw_page['html'], 'html.parser')
        source_url = raw_page['source_url']
        jobs: list[JobDict] = []

        for li in soup.find_all('li'):
            link = li.find('a', href=lambda h: h and '/job?id=' in h)
            if not link:
                continue
            h3 = link.find('h3')
            if not h3:
                continue

            title = h3.get_text(strip=True)
            job_url = _BASE + link['href']

            img = li.find('img')
            company = ''
            if img:
                alt = img.get('alt', '')
                if alt.startswith('Logo: '):
                    company = alt[6:].strip()

            # Direct text node children of li (not inside nested elements)
            location_texts = [
                c.strip() for c in li.children
                if isinstance(c, NavigableString) and c.strip()
            ]
            location = location_texts[-1] if location_texts else ''

            description = f'{title} at {company}. Location: {location} | {source_url} | jobs.heise.de'

            jobs.append({
                'title': title,
                'company': company,
                'description': description,
                'url': job_url,
                'location': location,
                'source_url': source_url,
            })

        next_token: str | None = None
        next_el = soup.find('a', rel=lambda r: 'next' in (r if isinstance(r, list) else [r]))
        if next_el and next_el.get('href'):
            m = re.search(r'[?&]page=(\d+)', next_el['href'])
            if m:
                next_token = m.group(1)

        return jobs, next_token
