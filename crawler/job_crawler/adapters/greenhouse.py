"""Adapter for Greenhouse-hosted career pages (boards.greenhouse.io)."""

from __future__ import annotations

import re
from urllib.parse import urlparse

import requests

from job_crawler.adapters.base import CareerSiteAdapter, AuthContext, RawPage, JobDict, USER_AGENT

_API_BASE = 'https://boards-api.greenhouse.io/v1/boards'
_TAG_RE = re.compile(r'<[^>]+>')


def _company_slug(url: str) -> str:
    slug = urlparse(url).path.strip('/').split('/')[0]
    if not slug:
        raise ValueError(f'Cannot extract company slug from URL: {url!r}')
    return slug


def _strip_html(html: str) -> str:
    return _TAG_RE.sub('', html or '').strip()


class GreenhouseAdapter(CareerSiteAdapter):
    """Fetches jobs from Greenhouse's public JSON API."""

    def can_handle(self, url: str) -> bool:
        return 'boards.greenhouse.io' in url

    def fetch_page(
        self, url: str, keywords: str, auth_context: AuthContext, page_token: str | None
    ) -> RawPage:
        slug = _company_slug(url)
        response = requests.get(
            f'{_API_BASE}/{slug}/jobs',
            params={'content': 'true'},
            headers={'User-Agent': USER_AGENT},
            timeout=30,
        )
        response.raise_for_status()
        return {'data': response.json(), 'source_url': url, 'slug': slug}

    def parse_jobs(self, raw_page: RawPage) -> tuple[list[JobDict], str | None]:
        source_url = raw_page['source_url']
        slug = raw_page.get('slug', _company_slug(source_url))
        jobs: list[JobDict] = []

        for item in raw_page['data'].get('jobs', []):
            title = (item.get('title') or '').strip()
            if not title:
                continue

            location = (item.get('location') or {}).get('name', '').strip()
            job_url = (item.get('absolute_url') or '').strip()
            departments = item.get('departments') or []
            department = (departments[0].get('name') or '') if departments else ''
            content_snippet = _strip_html(item.get('content') or '')[:200]

            parts = [title, 'at', slug]
            if department:
                parts.append(f'({department})')
            if location:
                parts.append(location)
            if content_snippet:
                parts.append(content_snippet)
            else:
                parts.append('Apply via Greenhouse')
            parts.append('greenhouse')
            description = ' | '.join(parts)

            jobs.append({
                'title': title,
                'company': slug,
                'description': description,
                'url': job_url,
                'location': location,
                'source_url': source_url,
            })

        return jobs, None
