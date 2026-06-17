"""Registry of career-site adapters, matched to a URL in order."""

from __future__ import annotations

from job_crawler.adapters.base import CareerSiteAdapter
from job_crawler.adapters.pythonjobs import PythonJobsAdapter

ADAPTER_REGISTRY: list[CareerSiteAdapter] = [
    PythonJobsAdapter(),
]


def find_adapter(url: str) -> CareerSiteAdapter | None:
    """Return the first registered adapter whose can_handle(url) is True."""
    for adapter in ADAPTER_REGISTRY:
        if adapter.can_handle(url):
            return adapter
    return None
