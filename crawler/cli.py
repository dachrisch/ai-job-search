import argparse
import multiprocessing
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
from job_crawler.adapters.registry import find_adapter
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


def _try_adapter(url: str, keywords: str) -> list[dict] | None:
    """
    Attempt to fetch jobs via a registered adapter for url.

    Returns a list of validated, camelCase job dicts if an adapter matched
    and produced at least one valid job. Returns None if no adapter matched,
    the adapter raised, or none of its jobs passed JobData validation — in
    all of these cases the caller should fall back to the generic spider.
    """
    adapter = find_adapter(url)
    if adapter is None:
        return None

    try:
        raw_jobs = adapter.run(url, keywords)
    except Exception as exc:
        log.warning(
            "Adapter failed; falling back to generic spider",
            extra={"url": url, "adapter": type(adapter).__name__, "error": str(exc)},
        )
        return None

    validated = [job for job in (scrapy_item_to_job_data(raw) for raw in raw_jobs) if job is not None]
    if not validated:
        return None

    return [job.model_dump(by_alias=True) for job in validated]


# Global list to collect jobs from pipeline (reset before each crawl)
# Only used within a worker subprocess — never shared across processes.
collected_jobs = []


class JobCollectorPipeline:
    def process_item(self, item, spider):
        for field in item.fields:
            if isinstance(item[field], str):
                item[field] = ' '.join(item[field].split())
        collected_jobs.append(dict(item))
        return item


def _run_crawl_jobs_worker(
    queue: multiprocessing.Queue,
    sites: list,
    keywords: str,
    config_timeout: int | None,
    config_max_retries: int | None,
) -> None:
    """
    Worker that runs Scrapy in a fresh subprocess so the Twisted reactor
    starts clean. Results are put on queue as a list of raw result dicts.
    """
    global collected_jobs
    collected_jobs = []

    from scrapy.crawler import CrawlerProcess
    from scrapy.utils.project import get_project_settings
    from job_crawler.spiders.generic_spider import GenericJobSpider
    from job_crawler.spiders.linkedin_spider import LinkedInSpider
    from job_crawler.spiders.indeed_spider import IndeedSpider
    from job_crawler.spiders.glassdoor_spider import GlassdoorSpider
    from models import CrawlerConfig, SiteResult, scrapy_item_to_job_data
    import config as _cfg
    from collections import defaultdict

    REGISTRY = [
        ("linkedin.com", LinkedInSpider),
        ("indeed.com", IndeedSpider),
        ("glassdoor.com", GlassdoorSpider),
    ]

    def resolve(domain):
        for pat, cls in REGISTRY:
            if pat in domain:
                return cls
        return GenericJobSpider

    cfg = CrawlerConfig(timeout=config_timeout, max_retries=config_max_retries)
    site_jobs: dict = defaultdict(list)
    site_errors: dict = defaultdict(list)
    for site in sites:
        site_jobs[site]
        site_errors[site]

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
    for site in sites:
        spider_cls = resolve(site)
        process.crawl(spider_cls, urls=[f"https://{site}/jobs"], keywords=keywords)

    try:
        process.start()
    except Exception:
        pass

    for raw_item in collected_jobs:
        source_url = raw_item.get('source_url', '')
        matched = next((s for s in sites if s in source_url), source_url or 'unknown')
        job = scrapy_item_to_job_data(raw_item)
        if job is not None:
            site_jobs[matched].append(job)

    timestamp = SiteResult.utc_now_iso()
    results = [
        {
            'source': site,
            'jobs': [j.model_dump(by_alias=True) for j in site_jobs[site]],
            'errors': site_errors[site],
            'timestamp': timestamp,
        }
        for site in sites
    ]
    queue.put(results)


def _run_company_crawl_worker(
    queue: multiprocessing.Queue,
    search_id: str,
    company_id: str,
    url: str,
    company_name: str,
    keywords: str,
) -> None:
    """
    Worker that runs a single company crawl in a fresh subprocess so the
    Twisted reactor starts clean.
    """
    global collected_jobs
    collected_jobs = []

    adapter_jobs = _try_adapter(url, keywords)
    if adapter_jobs is not None:
        queue.put({
            "search_id": search_id,
            "company_id": company_id,
            "jobs": adapter_jobs,
            "unsupported": False,
            "discovered_companies": [],
            "errors": [],
            "timestamp": SiteResult.utc_now_iso(),
        })
        return

    from scrapy.crawler import CrawlerProcess
    from scrapy.utils.project import get_project_settings
    from job_crawler.spiders.generic_career_spider import GenericCareerPageSpider
    import config as _cfg

    settings = get_project_settings()
    settings.set('ITEM_PIPELINES', {'cli.JobCollectorPipeline': 300})
    settings.set('ROBOTSTXT_OBEY', True)
    settings.set('CONCURRENT_REQUESTS', 1)
    settings.set('DOWNLOAD_DELAY', 1)
    settings.set('USER_AGENT', _cfg.DEFAULT_USER_AGENT)
    settings.set('LOG_LEVEL', 'INFO')
    settings.set('DOWNLOAD_TIMEOUT', 30)

    process = CrawlerProcess(settings)
    process.crawl(GenericCareerPageSpider, urls=[url], keywords=keywords, company_name=company_name)

    try:
        process.start()
    except Exception:
        pass

    validated_jobs = []
    for raw_item in collected_jobs:
        job = scrapy_item_to_job_data(raw_item)
        if job is not None:
            validated_jobs.append(job)

    queue.put({
        "search_id": search_id,
        "company_id": company_id,
        "jobs": [j.model_dump(by_alias=True) for j in validated_jobs],
        "unsupported": len(validated_jobs) == 0,
        "discovered_companies": [],
        "errors": [],
        "timestamp": SiteResult.utc_now_iso(),
    })


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


def crawl_jobs(  # noqa: C901
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
        log.info("Registering spiders for sites", extra={"sites": active_sites})

        # Run the Scrapy crawl in a child process so the Twisted reactor starts
        # fresh on every request (ReactorNotRestartable otherwise).
        queue: multiprocessing.Queue = multiprocessing.Queue()
        worker = multiprocessing.Process(
            target=_run_crawl_jobs_worker,
            args=(queue, active_sites, keywords, cfg.timeout, cfg.max_retries),
            daemon=True,
        )
        worker.start()
        timeout_s = (cfg.timeout or 30) * len(active_sites) + 60
        worker.join(timeout=timeout_s)

        if not queue.empty():
            raw_results = queue.get_nowait()
            for raw in raw_results:
                site = raw.get('source', '')
                for job_dict in raw.get('jobs', []):
                    job = scrapy_item_to_job_data(job_dict)
                    if job is not None:
                        site_jobs[site].append(job)
                site_errors[site].extend(raw.get('errors', []))
        else:
            # Worker timed out or crashed
            for site in active_sites:
                site_errors[site].append(_make_error_dict(
                    message="Scrapy worker timed out or crashed",
                    site=site,
                    error_type=ErrorType.UNKNOWN,
                    retry_count=0,
                ))

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
    log.info(
        "Crawling company",
        extra={
            "search_id": search_id,
            "company_id": company_id,
            "company_name": company_name,
            "url": url,
        },
    )

    # Run in a child process so the Twisted reactor starts fresh every time.
    queue: multiprocessing.Queue = multiprocessing.Queue()
    worker = multiprocessing.Process(
        target=_run_company_crawl_worker,
        args=(queue, search_id, company_id, url, company_name, keywords),
        daemon=True,
    )
    worker.start()
    worker.join(timeout=60)

    if not queue.empty():
        result = queue.get_nowait()
        log.info(
            "Company crawl succeeded",
            extra={
                "search_id": search_id,
                "company_id": company_id,
                "jobs_extracted": len(result.get("jobs", [])),
            },
        )
        return result

    log.error(
        "Company crawl worker timed out or crashed",
        extra={"search_id": search_id, "company_id": company_id},
    )
    return {
        "search_id": search_id,
        "company_id": company_id,
        "jobs": [],
        "discovered_companies": [],
        "errors": [{"message": "Crawl worker timed out or crashed", "site": url, "error_type": ErrorType.UNKNOWN}],
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
