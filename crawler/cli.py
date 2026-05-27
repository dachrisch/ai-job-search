import argparse
import sys
from scrapy.crawler import CrawlerProcess
from scrapy.utils.project import get_project_settings
from job_crawler.spiders.generic_spider import GenericJobSpider


# Global list to collect jobs from pipeline
collected_jobs = []


class JobCollectorPipeline:
    def process_item(self, item, spider):
        # Normalize whitespace in all fields
        for field in item.fields:
            if isinstance(item[field], str):
                item[field] = ' '.join(item[field].split())
        collected_jobs.append(dict(item))
        return item


def crawl_jobs(urls, keywords):
    """
    Crawl job listings from specified URLs with given keywords.

    Args:
        urls (list): List of URLs to crawl
        keywords (list): List of keywords to filter jobs

    Returns:
        dict: Dictionary with found count, jobs list, and newSites list
    """
    global collected_jobs
    collected_jobs = []

    # Get Scrapy settings
    settings = get_project_settings()

    # Override pipeline to collect jobs
    settings.set('ITEM_PIPELINES', {
        'cli.JobCollectorPipeline': 300,
    })

    # Set custom settings
    settings.set('ROBOTSTXT_OBEY', True)
    settings.set('CONCURRENT_REQUESTS', 16)
    settings.set('DOWNLOAD_DELAY', 1)
    settings.set('USER_AGENT', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')
    settings.set('LOG_LEVEL', 'INFO')

    # Create crawler process
    process = CrawlerProcess(settings)

    # Add spider with urls and keywords
    process.crawl(GenericJobSpider, urls=urls, keywords=keywords)

    # Start crawling
    try:
        process.start()
    except Exception as e:
        print(f"Error during crawling: {e}", file=sys.stderr)
        return {
            'found': 0,
            'jobs': [],
            'newSites': []
        }

    # Return results
    return {
        'found': len(collected_jobs),
        'jobs': collected_jobs,
        'newSites': list(set([job.get('source_url') for job in collected_jobs if job.get('source_url')]))
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Crawl job listings from specified URLs')
    parser.add_argument('urls', nargs='+', help='URLs to crawl')
    parser.add_argument('--keywords', nargs='+', help='Keywords to filter jobs')

    args = parser.parse_args()

    keywords = args.keywords if args.keywords else []
    result = crawl_jobs(args.urls, keywords)

    print(f"Found {result['found']} jobs")
    print(f"Jobs: {result['jobs']}")
    print(f"New Sites: {result['newSites']}")
