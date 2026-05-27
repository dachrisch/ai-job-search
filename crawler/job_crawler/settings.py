BOT_NAME = 'job_crawler'

SPIDER_MODULES = ['job_crawler.spiders']
NEWSPIDER_MODULE = 'job_crawler.spiders'

ROBOTSTXT_OBEY = True

CONCURRENT_REQUESTS = 16

DOWNLOAD_DELAY = 1

USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'

ITEM_PIPELINES = {
    'job_crawler.pipelines.JobPipeline': 300,
}

LOG_LEVEL = 'INFO'
