import os
from flask import Flask, request, jsonify
from dotenv import load_dotenv
from pydantic import ValidationError

from cli import crawl_jobs
from models import CrawlerRequest, SiteResult
from logger import get_logger, set_request_id
from config import CRAWLER_PORT
from resilience import CircuitBreaker, RateLimiter

load_dotenv()

app = Flask(__name__)
log = get_logger(__name__)

# ---------------------------------------------------------------------------
# Module-level resilience state (persists across all requests in this process)
# ---------------------------------------------------------------------------
# Keyed by domain string.  Entries are created lazily on first request for
# a domain so that configuration reads happen at module import time.
_circuit_breakers: dict[str, CircuitBreaker] = {}
_rate_limiters: dict[str, RateLimiter] = {}


def _get_or_create_breaker(domain: str) -> CircuitBreaker:
    """Return existing CircuitBreaker for domain, or create and register one."""
    if domain not in _circuit_breakers:
        _circuit_breakers[domain] = CircuitBreaker(domain=domain)
        log.info("Circuit breaker created", extra={"domain": domain})
    return _circuit_breakers[domain]


def _get_or_create_limiter(domain: str) -> RateLimiter:
    """Return existing RateLimiter for domain, or create and register one."""
    if domain not in _rate_limiters:
        _rate_limiters[domain] = RateLimiter(domain=domain)
        log.info("Rate limiter created", extra={"domain": domain})
    return _rate_limiters[domain]


@app.route('/crawler/scrape', methods=['POST'])
def scrape():
    """
    HTTP endpoint for scraping jobs.

    Expected JSON payload (camelCase):
    {
        "searchId": "uuid-correlation-id",
        "sites": ["linkedin.com", "indeed.com"],
        "keywords": "senior python engineer remote",
        "config": {
            "timeout": 30,
            "maxRetries": 3
        }
    }

    Returns:
        200 — JSON array of SiteResult objects (may include errors for failed sites)
        400 — Validation error detail
        500 — Unexpected internal error
    """
    data = request.get_json()

    if not data:
        return jsonify({'error': 'No JSON data provided'}), 400

    # --- Request validation ------------------------------------------------
    try:
        req = CrawlerRequest.model_validate(data)
    except ValidationError as exc:
        log.warning("Invalid request payload", extra={"errors": exc.errors()})
        return jsonify({
            'error': 'Request validation failed',
            'detail': exc.errors(include_url=False),
        }), 400

    set_request_id(req.search_id)

    log.info(
        "Scrape request received",
        extra={
            "search_id": req.search_id,
            "sites": req.sites,
            "keywords": req.keywords,
        },
    )

    # --- Initialise / retrieve per-domain resilience instances -------------
    breakers = {site: _get_or_create_breaker(site) for site in req.sites}
    limiters = {site: _get_or_create_limiter(site) for site in req.sites}

    # Log current circuit breaker states for observability
    for site, breaker in breakers.items():
        log.info(
            "Circuit breaker state",
            extra={
                "site": site,
                "state": breaker.state.value,
                "failure_count": breaker.failure_count,
            },
        )

    # --- Crawl -------------------------------------------------------------
    try:
        raw_results = crawl_jobs(
            req.sites,
            req.keywords,
            req.config,
            circuit_breakers=breakers,
            rate_limiters=limiters,
        )
    except Exception as exc:
        log.error("Crawl failed unexpectedly", extra={"error": str(exc)})
        return jsonify({'error': str(exc)}), 500

    # --- Response validation -----------------------------------------------
    validated: list[SiteResult] = []
    for raw in raw_results:
        try:
            validated.append(SiteResult.model_validate(raw))
        except ValidationError as exc:
            log.warning(
                "SiteResult validation failed; skipping site",
                extra={"source": raw.get("source"), "errors": exc.errors()},
            )

    log.info(
        "Scrape complete",
        extra={
            "search_id": req.search_id,
            "sites_returned": len(validated),
            "total_jobs": sum(len(s.jobs) for s in validated),
            "total_errors": sum(len(s.errors) for s in validated),
        },
    )

    return jsonify([site.model_dump(by_alias=True) for site in validated]), 200


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=CRAWLER_PORT, debug=False)
