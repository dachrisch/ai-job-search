"""
job_crawler — Scrapy-based job listing crawler package.

Exposes the primary Scrapy Item class and package metadata so downstream
code (tests, cli.py, server.py) can import them without deep path knowledge:

    from job_crawler import JobItem, __version__
"""

from job_crawler.items import JobItem  # noqa: F401  (re-export)

__version__ = "0.1.0"
__all__ = ["JobItem", "__version__"]
