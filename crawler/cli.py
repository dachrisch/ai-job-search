import argparse
import socket
import time
from collections import defaultdict
from scrapy.crawler import CrawlerProcess
from scrapy.utils.project import get_project_settings
from job_crawler.spiders.generic_spider import GenericJobSpider
from job_crawler.spiders.linkedin_spider import LinkedInSpider
from job_crawler.spiders.indeed_spider import IndeedSpider
from job_crawler.spiders.glassdoor_spider import GlassdoorSpider
from models import CrawlerConfig, SiteResult, scrapy_item_to_job_data
from logger import get_logger
from resilience import (
    CircuitBreaker,
    CircuitState,
    CrawlerError,
    ErrorType,
    RateLimiter,
    RetryStrategy,
)
import config as _cfg

log = get_logger(__name__)

# SPIDER_REGISTRY maps domain substring → spider class.
# Checked in order; first match wins.  GenericJobSpider is the fallback.
SPIDER_REGISTRY: list[tuple[str, type]] = [
    ("linkedin.com", LinkedInSpider),
    ("indeed.com",   IndeedSpider),
    ("glassdoor.com", GlassdoorSpider),
]


def _resolve_spider(domain: str) -> type:
    """
    Return the spider class for a given domain.

    Args:
        domain: A job board domain string, e.g. 'linkedin.com'.

    Returns:
        The matching spider class, or GenericJobSpider if no match.
    """
    for pattern, spider_cls in SPIDER_REGISTRY:
        if pattern in domain:
            return spider_cls
    return GenericJobSpider


# Global list to collect jobs from pipeline (reset before each crawl)
collected_jobs = []


class JobCollectorPipeline:
    def process_item(self, item, spider):
        for field in item.fields:
            if isinstance(item[field], str):
                item[field] = ' '.join(item[field].split())
        collected_jobs.append(dict(item))
        return item


def _classify_exception(exc: BaseException) -> str:
    """
    Map a Python exception to an ErrorType constant.

    Scrapy wraps low-level errors in its own exception hierarchy, but the
    underlying causes (socket timeout, connection refused) are still inspectable
    via the exception message or __cause__.
    """
    exc_type = type(exc).__name__
    exc_msg = str(exc).lower()

    # Timeout signals
    if exc_type in ("TimeoutError", "DownloadTimeoutError", "ConnectionTimeoutError"):
        return ErrorType.TIMEOUT
    if "timeout" in exc_msg:
        return ErrorType.TIMEOUT

    # Network / connection signals
    if exc_type in ("ConnectionRefusedError", "ConnectionResetError", "DNSLookupError"):
        return ErrorType.NETWORK
    if isinstance(exc, (ConnectionError, socket.error, OSError)):
        return ErrorType.NETWORK
    if any(kw in exc_msg for kw in ("connection", "dns", "refused", "reset", "network")):
        return ErrorType.NETWORK

    # Rate limiting signals (HTTP 429 manifests as Scrapy HTTP errors)
    if "429" in exc_msg or "rate limit" in exc_msg or "too many requests" in exc_msg:
        return ErrorType.RATE_LIMITED

    # Invalid / unparseable response
    if any(kw in exc_msg for kw in ("invalid", "parse", "decode", "malformed")):
        return ErrorType.INVALID_RESPONSE

    return ErrorType.UNKNOWN


def _make_error_dict(
    message: str,
    site: str,
    error_type: str = ErrorType.UNKNOWN,
    retry_count: int = 0,
) -> dict:
    """Build a normalised error dict for inclusion in SiteResult.errors."""
    return {
        "message": message,
        "site": site,
        "error_type": error_type,
        "retry_count": retry_count,
    }


def crawl_jobs(
    sites: list[str],
    keywords: str,
    config: CrawlerConfig | None = None,
    circuit_breakers: dict[str, CircuitBreaker] | None = None,
    rate_limiters: dict[str, RateLimiter] | None = None,
) -> list[dict]:
    """
    Crawl job listings from the given site domains with the given keywords.

    Applies pre-flight circuit breaker checks: sites with an OPEN breaker are
    excluded from the Scrapy run and returned with a synthetic error entry.
    After the run, updates breakers and rate limiters based on per-site outcomes.

    Args:
        sites:            Domain list, e.g. ['linkedin.com', 'indeed.com'].
        keywords:         Search query string forwarded to each spider.
        config:           Optional CrawlerConfig with timeout / maxRetries overrides.
        circuit_breakers: Optional dict mapping domain -> CircuitBreaker instance.
                          Shared by server.py across requests.
        rate_limiters:    Optional dict mapping domain -> RateLimiter instance.
                          Shared by server.py across requests.

    Returns:
        A list of plain dicts, each serialising a SiteResult (camelCase keys).
        Always returns one entry per requested site. Failed sites have non-empty
        'errors' arrays; the overall list is never empty.
    """
    global collected_jobs
    collected_jobs = []

    cfg = config or CrawlerConfig()
    breakers = circuit_breakers or {}
    limiters = rate_limiters or {}

    # ------------------------------------------------------------------
    # Pre-flight: partition sites by circuit breaker state
    # ------------------------------------------------------------------
    active_sites: list[str] = []       # will be crawled
    skipped_results: list[dict] = []   # pre-populated error entries

    for site in sites:
        breaker = breakers.get(site)
        if breaker is None:
            active_sites.append(site)
            continue

        state = breaker.state  # property handles OPEN->HALF_OPEN auto-transition

        if state is CircuitState.OPEN:
            log.warning(
                "Circuit breaker OPEN; skipping site",
                extra={
                    "site": site,
                    "failure_count": breaker.failure_count,
                },
            )
            skipped_results.append({
                "source": site,
                "jobs": [],
                "errors": [_make_error_dict(
                    message=f"Circuit breaker OPEN after {breaker.failure_count} failures",
                    site=site,
                    error_type=ErrorType.NETWORK,
                    retry_count=0,
                )],
                "timestamp": SiteResult.utc_now_iso(),
            })
        elif state is CircuitState.HALF_OPEN:
            log.info(
                "Circuit breaker HALF_OPEN; attempting probe request",
                extra={"site": site},
            )
            active_sites.append(site)
        else:  # CLOSED
            active_sites.append(site)

    # ------------------------------------------------------------------
    # Apply rate limiter pre-request delay for active sites
    # ------------------------------------------------------------------
    for site in active_sites:
        limiter = limiters.get(site)
        if limiter is not None:
            limiter.wait_if_needed()
            limiter.record_request()

    # ------------------------------------------------------------------
    # Build Scrapy run
    # ------------------------------------------------------------------
    # Group results initialised for all active sites
    site_jobs: dict[str, list] = defaultdict(list)
    site_errors: dict[str, list] = defaultdict(list)

    for site in active_sites:
        site_jobs[site]   # touch to create key
        site_errors[site]

    if active_sites:
        settings = get_project_settings()

        settings.set('ITEM_PIPELINES', {'cli.JobCollectorPipeline': 300})
        settings.set('ROBOTSTXT_OBEY', True)
        settings.set('CONCURRENT_REQUESTS', 16)
        settings.set('DOWNLOAD_DELAY', 1)
        settings.set('USER_AGENT', _cfg.DEFAULT_USER_AGENT)
        settings.set('LOG_LEVEL', 'INFO')

        if cfg.timeout is not None:
            settings.set('DOWNLOAD_TIMEOUT', cfg.timeout)

        if cfg.max_retries is not None:
            settings.set('RETRY_TIMES', cfg.max_retries)

        process = CrawlerProcess(settings)

        for site in active_sites:
            spider_cls = _resolve_spider(site)
            url = f"https://{site}/jobs"
            log.info(
                "Registering spider for site",
                extra={"site": site, "spider": spider_cls.name, "url": url},
            )
            process.crawl(spider_cls, urls=[url], keywords=keywords)

        try:
            process.start()
        except Exception as exc:
            error_type = _classify_exception(exc)
            log.error(
                "Scrapy process failed",
                extra={"error": str(exc), "error_type": error_type},
            )
            # All active sites get the error; update breakers
            for site in active_sites:
                breaker = breakers.get(site)
                if breaker is not None:
                    prev_state = breaker.state
                    breaker.record_failure()
                    if breaker.state is not prev_state:
                        log.warning(
                            "Circuit breaker state changed",
                            extra={
                                "site": site,
                                "from": prev_state.value,
                                "to": breaker.state.value,
                            },
                        )
                site_errors[site].append(_make_error_dict(
                    message=str(exc),
                    site=site,
                    error_type=error_type,
                    retry_count=0,
                ))

        # ------------------------------------------------------------------
        # Map collected items back to requesting domains
        # ------------------------------------------------------------------
        for raw_item in collected_jobs:
            source_url: str = raw_item.get('source_url', '')
            matched_site = next(
                (s for s in active_sites if s in source_url),
                source_url or 'unknown',
            )
            job = scrapy_item_to_job_data(raw_item)
            if job is not None:
                site_jobs[matched_site].append(job)
            else:
                site_errors[matched_site].append({
                    'message': 'Item failed validation',
                    'site': matched_site,
                    'error_type': ErrorType.INVALID_RESPONSE,
                    'retry_count': 0,
                    'raw': {k: v for k, v in raw_item.items() if k != 'description'},
                })

    # ------------------------------------------------------------------
    # Post-flight: update circuit breakers and rate limiters
    # ------------------------------------------------------------------
    for site in active_sites:
        breaker = breakers.get(site)
        if breaker is None:
            continue

        has_errors = bool(site_errors[site])
        has_jobs = bool(site_jobs[site])

        # Check if any error was a rate limit
        rate_limit_errors = [
            e for e in site_errors[site]
            if e.get("error_type") == ErrorType.RATE_LIMITED
        ]

        if rate_limit_errors:
            limiter = limiters.get(site)
            if limiter is not None:
                attempt = len(rate_limit_errors) - 1
                limiter.record_429(attempt)
            breaker.record_failure()
        elif has_errors and not has_jobs:
            # Treat a site with only errors (no jobs at all) as a failure
            prev_state = breaker.state
            breaker.record_failure()
            if breaker.state is not prev_state:
                log.warning(
                    "Circuit breaker state changed",
                    extra={
                        "site": site,
                        "from": prev_state.value,
                        "to": breaker.state.value,
                    },
                )
        else:
            # Jobs found or no errors: treat as success
            prev_state = breaker.state
            breaker.record_success()
            if breaker.state is not prev_state:
                log.info(
                    "Circuit breaker state changed",
                    extra={
                        "site": site,
                        "from": prev_state.value,
                        "to": breaker.state.value,
                    },
                )

    # ------------------------------------------------------------------
    # Build final results list
    # ------------------------------------------------------------------
    timestamp = SiteResult.utc_now_iso()
    crawled_results = []
    for site in active_sites:
        crawled_results.append({
            'source': site,
            'jobs': [j.model_dump(by_alias=True) for j in site_jobs[site]],
            'errors': site_errors[site],
            'timestamp': timestamp,
        })

    results = crawled_results + skipped_results

    # Restore original site ordering
    site_order = {site: i for i, site in enumerate(sites)}
    results.sort(key=lambda r: site_order.get(r['source'], len(sites)))

    log.info(
        "Crawl complete",
        extra={
            "sites_crawled": len(active_sites),
            "sites_skipped": len(skipped_results),
            "total_jobs": sum(len(r['jobs']) for r in crawled_results),
            "total_errors": sum(len(r['errors']) for r in results),
        },
    )

    return results


def crawl_company_jobs(
    search_id: str,
    company_id: str,
    url: str,
    company_name: str,
    keywords: str,
) -> dict:
    """
    Crawl a single company career page.

    Routes to GenericCareerPageSpider which is designed for company sites.
    Returns: { searchId, companyId, jobs: [...], discoveredCompanies: [...], errors: [...] }
    """
    global collected_jobs
    collected_jobs = []

    log.info(
        "Crawling company",
        extra={
            "search_id": search_id,
            "company_id": company_id,
            "company_name": company_name,
            "url": url,
        },
    )

    try:
        settings = get_project_settings()
        settings.set('ITEM_PIPELINES', {'cli.JobCollectorPipeline': 300})
        settings.set('ROBOTSTXT_OBEY', True)
        settings.set('CONCURRENT_REQUESTS', 1)  # Single company, no concurrency
        settings.set('DOWNLOAD_DELAY', 1)
        settings.set('USER_AGENT', _cfg.DEFAULT_USER_AGENT)
        settings.set('LOG_LEVEL', 'INFO')
        settings.set('DOWNLOAD_TIMEOUT', 30)

        process = CrawlerProcess(settings)

        # Route to GenericCareerPageSpider
        from job_crawler.spiders.generic_career_spider import GenericCareerPageSpider

        log.info(
            "Registering generic_career_spider",
            extra={"url": url, "company": company_name},
        )

        process.crawl(
            GenericCareerPageSpider,
            urls=[url],
            keywords=keywords,
            company_name=company_name,
        )

        process.start()

        # Validate and convert items
        validated_jobs = []
        for raw_item in collected_jobs:
            job = scrapy_item_to_job_data(raw_item)
            if job is not None:
                validated_jobs.append(job)

        log.info(
            "Company crawl succeeded",
            extra={
                "search_id": search_id,
                "company_id": company_id,
                "jobs_extracted": len(validated_jobs),
            },
        )

        return {
            "search_id": search_id,
            "company_id": company_id,
            "jobs": [j.model_dump(by_alias=True) for j in validated_jobs],
            "discovered_companies": [],  # Future: extract sister companies
            "errors": [],
            "timestamp": SiteResult.utc_now_iso(),
        }

    except Exception as exc:
        error_msg = str(exc)
        log.error(
            "Company crawl failed",
            extra={
                "search_id": search_id,
                "company_id": company_id,
                "error": error_msg,
            },
        )

        return {
            "search_id": search_id,
            "company_id": company_id,
            "jobs": [],
            "discovered_companies": [],
            "errors": [
                {
                    "message": error_msg,
                    "site": url,
                    "error_type": ErrorType.UNKNOWN,
                }
            ],
            "timestamp": SiteResult.utc_now_iso(),
        }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Crawl job listings from job board domains')
    parser.add_argument('sites', nargs='+', help='Domain names to crawl (e.g. linkedin.com)')
    parser.add_argument('--keywords', default='', help='Keywords / search query')

    args = parser.parse_args()

    results = crawl_jobs(args.sites, args.keywords)

    for site_result in results:
        print(f"Site: {site_result['source']}")
        print(f"  Jobs found: {len(site_result['jobs'])}")
        print(f"  Errors: {len(site_result['errors'])}")
        print(f"  Timestamp: {site_result['timestamp']}")
