"""
Scrapy project settings.

All tuneable values are imported from config.py which reads them from
environment variables — never hardcode timeouts, delays, or user agents here.
"""

import sys
import os

# Allow `import config` to resolve from the crawler/ root directory regardless
# of how Scrapy is invoked (scrapy crawl, CrawlerProcess, pytest, etc.).
_crawler_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _crawler_root not in sys.path:
    sys.path.insert(0, _crawler_root)

from config import (  # noqa: E402
    DEFAULT_USER_AGENT,
    CRAWLER_DOWNLOAD_DELAY,
    CRAWLER_CONCURRENT_REQUESTS,
    LOG_LEVEL,
)

BOT_NAME = 'job_crawler'

SPIDER_MODULES = ['job_crawler.spiders']
NEWSPIDER_MODULE = 'job_crawler.spiders'

ROBOTSTXT_OBEY = True

CONCURRENT_REQUESTS = CRAWLER_CONCURRENT_REQUESTS

DOWNLOAD_DELAY = CRAWLER_DOWNLOAD_DELAY

USER_AGENT = DEFAULT_USER_AGENT

ITEM_PIPELINES = {
    'job_crawler.pipelines.JobPipeline': 300,
}

LOG_LEVEL = LOG_LEVEL
