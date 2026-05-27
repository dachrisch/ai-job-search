import scrapy


class JobItem(scrapy.Item):
    title = scrapy.Field()
    company = scrapy.Field()
    description = scrapy.Field()
    url = scrapy.Field()
    salary = scrapy.Field()
    location = scrapy.Field()
    source_url = scrapy.Field()
