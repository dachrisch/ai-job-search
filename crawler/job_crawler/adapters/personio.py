"""Adapter for Personio-hosted career pages (*.jobs.personio.de / *.jobs.personio.com)."""

from __future__ import annotations

import xml.etree.ElementTree as ET
from urllib.parse import urlparse

import requests

from job_crawler.adapters.base import CareerSiteAdapter, AuthContext, RawPage, JobDict, USER_AGENT


def _base_url(url: str) -> str:
    """Return scheme + host, stripping any path."""
    parsed = urlparse(url)
    return f'{parsed.scheme}://{parsed.netloc}'


class PersonioAdapter(CareerSiteAdapter):
    """Fetches job listings from Personio's public XML feed."""

    def can_handle(self, url: str) -> bool:
        return 'jobs.personio.de' in url or 'jobs.personio.com' in url

    def fetch_page(self, url: str, keywords: str, auth_context: AuthContext, page_token: str | None) -> RawPage:
        base = _base_url(url)
        response = requests.get(
            f'{base}/xml',
            headers={'User-Agent': USER_AGENT},
            timeout=30,
        )
        response.raise_for_status()
        return {'xml': response.text, 'base_url': base}

    def parse_jobs(self, raw_page: RawPage) -> tuple[list[JobDict], str | None]:
        base_url = raw_page['base_url']
        root = ET.fromstring(raw_page['xml'])
        jobs: list[JobDict] = []

        for position in root.findall('position'):
            job_id = position.findtext('id', '').strip()
            title = position.findtext('name', '').strip()
            company = position.findtext('subcompany', '').strip()
            location = position.findtext('office', '').strip()
            department = position.findtext('department', '').strip()
            schedule = position.findtext('schedule', '').strip()

            if not job_id or not title:
                continue

            description = (
                f'{title} at {company}. '
                f'Location: {location}. '
                f'Department: {department}. '
                f'Schedule: {schedule} | personio'
            )

            jobs.append({
                'title': title,
                'company': company,
                'description': description,
                'url': f'{base_url}/job/{job_id}',
                'location': location,
                'source_url': base_url,
            })

        return jobs, None
