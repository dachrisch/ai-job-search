import scrapy
from job_crawler.items import JobItem


class GenericJobSpider(scrapy.Spider):
    name = 'generic_job_spider'

    def __init__(self, urls=None, keywords=None, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.urls = urls or []
        self.keywords = keywords or []
        self.start_urls = self.urls

    def parse(self, response):
        # Generic CSS selectors for common job listing patterns
        job_containers = response.css('div.job-listing, div.job-item, article.job, li.job')

        if not job_containers:
            # Fallback to any div with job-related attributes
            job_containers = response.css('div[data-job], li[data-job], article[data-job]')

        for container in job_containers:
            item = JobItem()

            # Extract job title
            item['title'] = container.css('h2::text, h3::text, .job-title::text, .title::text').get('').strip()

            # Extract company name
            item['company'] = container.css('.company::text, .employer::text, .organization::text').get('').strip()

            # Extract job description
            item['description'] = container.css('.job-description::text, .description::text, p::text').get('').strip()

            # Extract job URL
            item['url'] = container.css('a::attr(href)').get('').strip()

            # Extract salary
            item['salary'] = container.css('.salary::text, .compensation::text').get('').strip()

            # Extract location
            item['location'] = container.css('.location::text, .job-location::text').get('').strip()

            # Set source URL
            item['source_url'] = response.url

            yield item
