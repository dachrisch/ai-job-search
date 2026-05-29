"""
Crawler configuration module.

All settings are read from environment variables with documented defaults.
No secrets or environment-specific values are hardcoded here.

Environment variables:
    CRAWLER_PORT          HTTP server port (default: 8000)
    CRAWLER_TIMEOUT       Per-site request timeout in seconds (default: 20)
    CRAWLER_MAX_RETRIES   Maximum retries per failed request (default: 2)
    CRAWLER_RETRY_BACKOFF Base backoff delay in seconds for retries (default: 2.0)
    CRAWLER_DOWNLOAD_DELAY Scrapy inter-request delay in seconds (default: 1.0)
    CRAWLER_CONCURRENT_REQUESTS Max concurrent Scrapy requests (default: 8)
    REDIS_URL             Redis connection URL (default: redis://localhost:6379)
    API_BASE_URL          Node.js API base URL (default: http://localhost:3000)
    API_CALLBACK_URL      URL to POST crawl results back to API (default: {API_BASE_URL}/api/crawler/results)
    LOG_LEVEL             Python logging level string (default: INFO)
    LOG_FORMAT            Log output format: 'json' or 'text' (default: json)
    CRAWLER_CIRCUIT_BREAKER_THRESHOLD Number of consecutive failures before opening circuit (default: 2)
    CRAWLER_CIRCUIT_BREAKER_TIMEOUT   Seconds circuit stays OPEN before transitioning to HALF_OPEN (default: 60)
    CRAWLER_RATE_LIMIT_WINDOW         Sliding window duration in seconds for rate tracking (default: 60)
    CRAWLER_RATE_LIMIT_MAX_REQUESTS   Max requests per domain per window (default: 30)
"""

import os

# ---------------------------------------------------------------------------
# HTTP Server
# ---------------------------------------------------------------------------

CRAWLER_PORT: int = int(os.getenv("CRAWLER_PORT", "8000"))

# ---------------------------------------------------------------------------
# Request / timeout behaviour
# ---------------------------------------------------------------------------

# Maximum seconds to wait for a single HTTP response from any target site.
# Design spec requires 15-30 seconds per site; default is 20.
CRAWLER_TIMEOUT: int = int(os.getenv("CRAWLER_TIMEOUT", "20"))

# Maximum number of automatic retries for transient errors (5xx, connection
# reset). Set to 0 to disable retries entirely.
CRAWLER_MAX_RETRIES: int = int(os.getenv("CRAWLER_MAX_RETRIES", "2"))

# Base delay (seconds) used for exponential back-off between retries.
# Actual delay for attempt n = CRAWLER_RETRY_BACKOFF * (2 ** n)
# attempt 0 → 2s, attempt 1 → 4s, attempt 2 → 8s
CRAWLER_RETRY_BACKOFF: float = float(os.getenv("CRAWLER_RETRY_BACKOFF", "2.0"))

# ---------------------------------------------------------------------------
# Scrapy-level throughput settings
# ---------------------------------------------------------------------------

# Seconds between successive requests to the same domain (Scrapy DOWNLOAD_DELAY).
CRAWLER_DOWNLOAD_DELAY: float = float(os.getenv("CRAWLER_DOWNLOAD_DELAY", "1.0"))

# Maximum simultaneous in-flight Scrapy requests across all domains.
CRAWLER_CONCURRENT_REQUESTS: int = int(os.getenv("CRAWLER_CONCURRENT_REQUESTS", "8"))

# ---------------------------------------------------------------------------
# User-agent rotation
# ---------------------------------------------------------------------------

# Pool of user-agent strings to rotate across requests.
# The spider selects agents round-robin to reduce bot detection.
USER_AGENTS: list[str] = [
    (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    (
        "Mozilla/5.0 (X11; Linux x86_64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) "
        "Gecko/20100101 Firefox/125.0"
    ),
    (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) "
        "AppleWebKit/605.1.15 (KHTML, like Gecko) "
        "Version/17.4.1 Safari/605.1.15"
    ),
]

# Default user agent used when rotation is not active (e.g. in cli.py).
DEFAULT_USER_AGENT: str = USER_AGENTS[0]

# ---------------------------------------------------------------------------
# Redis
# ---------------------------------------------------------------------------

# Full Redis connection URL.  Matches REDIS_URL used by the Node.js API so
# both services can share the same instance.
REDIS_URL: str = os.getenv("REDIS_URL", "redis://localhost:6379")

# ---------------------------------------------------------------------------
# Node.js API integration
# ---------------------------------------------------------------------------

# Base URL of the Express API server.
API_BASE_URL: str = os.getenv("API_BASE_URL", "http://localhost:3000")

# Endpoint the crawler POSTs results back to (alternative to direct Redis push).
API_CALLBACK_URL: str = os.getenv(
    "API_CALLBACK_URL",
    f"{API_BASE_URL}/api/crawler/results",
)

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO").upper()

# "json" produces machine-readable structured output; "text" is human-friendly.
LOG_FORMAT: str = os.getenv("LOG_FORMAT", "json").lower()

# ---------------------------------------------------------------------------
# Resilience — circuit breaker & rate limiting
# ---------------------------------------------------------------------------

# Number of consecutive per-domain failures required to open the circuit breaker.
# After this many failures, the domain is skipped until the timeout elapses.
CRAWLER_CIRCUIT_BREAKER_THRESHOLD: int = int(
    os.getenv("CRAWLER_CIRCUIT_BREAKER_THRESHOLD", "2")
)

# Seconds the circuit breaker stays OPEN before transitioning to HALF_OPEN
# and allowing a single probe request.
CRAWLER_CIRCUIT_BREAKER_TIMEOUT: float = float(
    os.getenv("CRAWLER_CIRCUIT_BREAKER_TIMEOUT", "60")
)

# Sliding window duration (seconds) used by the per-domain rate limiter.
CRAWLER_RATE_LIMIT_WINDOW: int = int(os.getenv("CRAWLER_RATE_LIMIT_WINDOW", "60"))

# Maximum number of requests allowed per domain within CRAWLER_RATE_LIMIT_WINDOW.
CRAWLER_RATE_LIMIT_MAX_REQUESTS: int = int(
    os.getenv("CRAWLER_RATE_LIMIT_MAX_REQUESTS", "30")
)
