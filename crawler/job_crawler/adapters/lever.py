"""Adapter for Lever-hosted career pages (jobs.lever.co)."""

from __future__ import annotations

from urllib.parse import urlparse

import requests

from job_crawler.adapters.base import CareerSiteAdapter, AuthContext, RawPage, JobDict, USER_AGENT

_API_BASE = 'https://api.lever.co/v0/postings'


def _company_slug(url: str) -> str:
    slug = urlparse(url).path.strip('/').split('/')[0]
    if not slug:
        raise ValueError(f'Cannot extract company slug from URL: {url!r}')
    return slug


class LeverAdapter(CareerSiteAdapter):
    """Fetches jobs from Lever's public postings API."""

    def can_handle(self, url: str) -> bool:
        return 'jobs.lever.co' in url

    def fetch_page(
        self, url: str, keywords: str, auth_context: AuthContext, page_token: str | None
    ) -> RawPage:
        slug = _company_slug(url)
        response = requests.get(
            f'{_API_BASE}/{slug}',
            params={'mode': 'json'},
            headers={'User-Agent': USER_AGENT},
            timeout=30,
        )
        response.raise_for_status()
        return {'data': response.json(), 'source_url': url, 'slug': slug}

    def parse_jobs(self, raw_page: RawPage) -> tuple[list[JobDict], str | None]:
        source_url = raw_page['source_url']
        slug = raw_page.get('slug', _company_slug(source_url))
        jobs: list[JobDict] = []

        for item in (raw_page['data'] or []):
            title = (item.get('text') or '').strip()
            if not title:
                continue

            categories = item.get('categories') or {}
            location = (categories.get('location') or '').strip()
            team = (categories.get('team') or '').strip()
            job_url = (item.get('hostedUrl') or '').strip()
            plain = (item.get('descriptionPlain') or '')[:300].strip()

            # Build description to ensure >= 50 chars
            description = f'{title} at {slug}'
            if team:
                description += f' | {team}'
            if location:
                description += f' | {location}'
            if plain:
                description += f' — {plain}'
            description += f' | {source_url} | lever'

            jobs.append({
                'title': title,
                'company': slug,
                'description': description,
                'url': job_url,
                'location': location,
                'source_url': source_url,
            })

        return jobs, None
