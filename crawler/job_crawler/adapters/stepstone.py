"""Adapter for StepStone (www.stepstone.de) job board."""

from __future__ import annotations

import requests
from bs4 import BeautifulSoup

from job_crawler.adapters.base import CareerSiteAdapter, AuthContext, RawPage, JobDict, USER_AGENT

_BASE = 'https://www.stepstone.de'


class StepStoneAdapter(CareerSiteAdapter):
    """Scrapes StepStone's server-rendered job listing pages."""

    def can_handle(self, url: str) -> bool:
        return 'stepstone.de' in url

    def fetch_page(
        self, url: str, keywords: str, auth_context: AuthContext, page_token: str | None
    ) -> RawPage:
        fetch_url = page_token if page_token else url
        response = requests.get(
            fetch_url,
            headers={'User-Agent': USER_AGENT},
            timeout=30,
        )
        response.raise_for_status()
        return {'html': response.text, 'source_url': fetch_url}

    def parse_jobs(self, raw_page: RawPage) -> tuple[list[JobDict], str | None]:
        soup = BeautifulSoup(raw_page['html'], 'html.parser')
        source_url = raw_page['source_url']
        jobs: list[JobDict] = []

        for article in soup.find_all('article', attrs={'data-at': 'job-item'}):
            title_el = article.find(attrs={'data-at': 'job-item-title'})
            company_el = article.find(attrs={'data-at': 'job-item-company-name'})
            location_el = article.find(attrs={'data-at': 'job-item-location'})
            desc_el = article.find(attrs={'data-at': 'jobcard-content'})

            title = title_el.get_text(strip=True) if title_el else ''
            href = title_el.get('href', '') if title_el else ''
            if not title or not href:
                continue

            job_url = href if href.startswith('http') else f'{_BASE}{href}'
            company = company_el.get_text(strip=True) if company_el else ''
            location = location_el.get_text(strip=True) if location_el else ''
            description = desc_el.get_text(strip=True) if desc_el else ''
            if not description or len(description) < 50:
                description = f'{title} at {company}. Location: {location} | stepstone.de'

            jobs.append({
                'title': title,
                'company': company,
                'description': description,
                'url': job_url,
                'location': location,
                'source_url': source_url,
            })

        next_link = soup.find('link', rel=lambda r: 'next' in (r if isinstance(r, list) else [r]))
        next_token = next_link['href'] if next_link and next_link.get('href') else None

        return jobs, next_token
