"""Registry of career-site adapters, matched to a URL in order."""

from __future__ import annotations

from job_crawler.adapters.base import CareerSiteAdapter
from job_crawler.adapters.djangofoundation import DjangoFoundationAdapter
from job_crawler.adapters.greenhouse import GreenhouseAdapter
from job_crawler.adapters.heisejobs import HeiseJobsAdapter
from job_crawler.adapters.lever import LeverAdapter
from job_crawler.adapters.personio import PersonioAdapter
from job_crawler.adapters.pythonjobs import PythonJobsAdapter
from job_crawler.adapters.smartrecruiters import SmartRecruitersAdapter

ADAPTER_REGISTRY: list[CareerSiteAdapter] = [
    PythonJobsAdapter(),
    PersonioAdapter(),
    GreenhouseAdapter(),
    LeverAdapter(),
    SmartRecruitersAdapter(),
    DjangoFoundationAdapter(),
    HeiseJobsAdapter(),
]


def find_adapter(url: str) -> CareerSiteAdapter | None:
    """Return the first registered adapter whose can_handle(url) is True."""
    for adapter in ADAPTER_REGISTRY:
        if adapter.can_handle(url):
            return adapter
    return None
