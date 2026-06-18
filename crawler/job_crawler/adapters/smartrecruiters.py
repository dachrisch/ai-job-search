"""Adapter for SmartRecruiters-hosted career pages (careers.smartrecruiters.com)."""

from __future__ import annotations

from urllib.parse import urlparse

import requests

from job_crawler.adapters.base import CareerSiteAdapter, AuthContext, RawPage, JobDict, USER_AGENT

_API_BASE = 'https://api.smartrecruiters.com/v1/companies'
_PAGE_SIZE = 100


def _company_slug(url: str) -> str:
    slug = urlparse(url).path.strip('/').split('/')[0]
    if not slug:
        raise ValueError(f'Cannot extract company slug from URL: {url!r}')
    return slug


class SmartRecruitersAdapter(CareerSiteAdapter):
    """Fetches jobs from SmartRecruiters' public postings API."""

    def can_handle(self, url: str) -> bool:
        return 'careers.smartrecruiters.com' in url

    def fetch_page(
        self, url: str, keywords: str, auth_context: AuthContext, page_token: str | None
    ) -> RawPage:
        slug = _company_slug(url)
        offset = int(page_token) if page_token else 0
        response = requests.get(
            f'{_API_BASE}/{slug}/postings',
            params={'limit': _PAGE_SIZE, 'offset': offset},
            headers={'User-Agent': USER_AGENT},
            timeout=30,
        )
        response.raise_for_status()
        return {'data': response.json(), 'source_url': url, 'slug': slug, 'offset': offset}

    def parse_jobs(self, raw_page: RawPage) -> tuple[list[JobDict], str | None]:
        source_url = raw_page['source_url']
        slug = raw_page.get('slug', _company_slug(source_url))
        data = raw_page['data']
        offset = raw_page.get('offset', 0)
        jobs: list[JobDict] = []

        for item in (data.get('content') or []):
            title = (item.get('name') or '').strip()
            if not title:
                continue

            loc = item.get('location') or {}
            city = (loc.get('city') or '').strip()
            country = (loc.get('country') or '').strip()
            location = ', '.join(filter(None, [city, country]))

            job_url = (item.get('ref') or '').strip()
            dept = (item.get('department') or {}).get('label', '').strip()

            description = title
            if dept:
                description += f' | {dept}'
            if location:
                description += f' | {location}'
            description += f' | {slug} | smartrecruiters'

            jobs.append({
                'title': title,
                'company': slug,
                'description': description,
                'url': job_url,
                'location': location,
                'source_url': source_url,
            })

        total = data.get('totalFound', 0)
        next_offset = offset + _PAGE_SIZE
        next_token = str(next_offset) if next_offset < total else None

        return jobs, next_token
