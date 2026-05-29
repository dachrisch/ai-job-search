"""
Resilience primitives for the crawler service.

Provides fault-tolerant patterns:
  - CrawlerError: typed exception hierarchy
  - RetryStrategy: exponential backoff calculation
  - CircuitBreaker: per-domain failure tracking and request gating
  - RateLimiter: per-domain 429 tracking with backoff delays
"""

from __future__ import annotations

import time
import threading
from collections import deque
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

import config  # for CRAWLER_MAX_RETRIES, CRAWLER_RETRY_BACKOFF, etc.


# ---------------------------------------------------------------------------
# Error type constants
# ---------------------------------------------------------------------------

class ErrorType:
    NETWORK = "NETWORK"
    TIMEOUT = "TIMEOUT"
    RATE_LIMITED = "RATE_LIMITED"
    INVALID_RESPONSE = "INVALID_RESPONSE"
    UNKNOWN = "UNKNOWN"


# Fatal errors that should not be retried
FATAL_ERROR_TYPES: frozenset[str] = frozenset({ErrorType.INVALID_RESPONSE})

# Transient errors that may succeed on retry
TRANSIENT_ERROR_TYPES: frozenset[str] = frozenset({
    ErrorType.NETWORK,
    ErrorType.TIMEOUT,
    ErrorType.RATE_LIMITED,
})


# ---------------------------------------------------------------------------
# CrawlerError
# ---------------------------------------------------------------------------

class CrawlerError(Exception):
    """Base exception for all crawler errors. Carries a typed error_type."""

    def __init__(self, message: str, error_type: str = ErrorType.UNKNOWN) -> None:
        super().__init__(message)
        self.error_type = error_type

    def __repr__(self) -> str:
        return f"{self.__class__.__name__}(error_type={self.error_type!r}, message={str(self)!r})"


# ---------------------------------------------------------------------------
# RetryStrategy
# ---------------------------------------------------------------------------

@dataclass
class RetryStrategy:
    """
    Computes exponential backoff delays for retry attempts.

    delay(attempt) = min(base_delay * (2 ** attempt), max_delay)

    attempt 0 → base_delay * 1 (first retry after initial failure)
    attempt 1 → base_delay * 2
    attempt 2 → base_delay * 4
    ...
    capped at max_delay
    """

    max_retries: int = field(default_factory=lambda: config.CRAWLER_MAX_RETRIES)
    base_delay: float = field(default_factory=lambda: config.CRAWLER_RETRY_BACKOFF)
    max_delay: float = 60.0

    def delay_for(self, attempt: int) -> float:
        """Return the sleep duration in seconds for the given attempt number (0-indexed)."""
        return min(self.base_delay * (2 ** attempt), self.max_delay)

    def should_retry(self, attempt: int, error_type: str) -> bool:
        """
        Return True if the error is transient and attempts remain.

        Args:
            attempt:    Number of attempts already made (0 = no retries yet).
            error_type: One of the ErrorType constants.
        """
        if error_type in FATAL_ERROR_TYPES:
            return False
        return attempt < self.max_retries


# ---------------------------------------------------------------------------
# CircuitBreaker
# ---------------------------------------------------------------------------

class CircuitState(Enum):
    CLOSED = "CLOSED"      # Normal operation
    OPEN = "OPEN"          # Failing; reject new requests
    HALF_OPEN = "HALF_OPEN"  # Probe: allow one request to test recovery


@dataclass
class CircuitBreaker:
    """
    Per-domain circuit breaker.

    State machine:
        CLOSED ──(2 consecutive failures)──> OPEN
        OPEN ──(60 seconds elapsed)──> HALF_OPEN
        HALF_OPEN ──(success)──> CLOSED
        HALF_OPEN ──(failure)──> OPEN

    Thread-safe via a single reentrant lock.
    """

    domain: str
    failure_threshold: int = field(
        default_factory=lambda: config.CRAWLER_CIRCUIT_BREAKER_THRESHOLD
    )
    timeout_seconds: float = field(
        default_factory=lambda: config.CRAWLER_CIRCUIT_BREAKER_TIMEOUT
    )

    _state: CircuitState = field(default=CircuitState.CLOSED, init=False, repr=False)
    _failure_count: int = field(default=0, init=False, repr=False)
    _last_failure_time: Optional[float] = field(default=None, init=False, repr=False)
    _lock: threading.RLock = field(default_factory=threading.RLock, init=False, repr=False)

    @property
    def state(self) -> CircuitState:
        """Return current state, transitioning OPEN -> HALF_OPEN if timeout elapsed."""
        with self._lock:
            if (
                self._state is CircuitState.OPEN
                and self._last_failure_time is not None
                and (time.monotonic() - self._last_failure_time) >= self.timeout_seconds
            ):
                self._state = CircuitState.HALF_OPEN
            return self._state

    @property
    def failure_count(self) -> int:
        with self._lock:
            return self._failure_count

    def is_open(self) -> bool:
        return self.state is CircuitState.OPEN

    def is_half_open(self) -> bool:
        return self.state is CircuitState.HALF_OPEN

    def is_closed(self) -> bool:
        return self.state is CircuitState.CLOSED

    def record_success(self) -> None:
        """Record a successful request. HALF_OPEN -> CLOSED, CLOSED stays CLOSED."""
        with self._lock:
            if self._state in (CircuitState.HALF_OPEN, CircuitState.CLOSED):
                self._state = CircuitState.CLOSED
                self._failure_count = 0
                self._last_failure_time = None

    def record_failure(self) -> None:
        """
        Record a failed request.

        CLOSED: increment failure count; if >= threshold, transition to OPEN.
        HALF_OPEN: immediately transition back to OPEN.
        OPEN: update last_failure_time (keeps the timeout window fresh).
        """
        with self._lock:
            self._failure_count += 1
            self._last_failure_time = time.monotonic()
            if self._state is CircuitState.HALF_OPEN:
                self._state = CircuitState.OPEN
            elif (
                self._state is CircuitState.CLOSED
                and self._failure_count >= self.failure_threshold
            ):
                self._state = CircuitState.OPEN

    def reset(self) -> None:
        """Manually reset the breaker to CLOSED state."""
        with self._lock:
            self._state = CircuitState.CLOSED
            self._failure_count = 0
            self._last_failure_time = None


# ---------------------------------------------------------------------------
# RateLimiter
# ---------------------------------------------------------------------------

@dataclass
class RateLimiter:
    """
    Per-domain sliding-window rate limiter with 429 back-off.

    Tracks timestamps of requests in the last `window_seconds`. When
    `max_requests` is reached, `wait_if_needed()` blocks until capacity is
    available. HTTP 429 responses trigger exponential backoff delays via
    RetryStrategy.
    """

    domain: str
    window_seconds: float = field(
        default_factory=lambda: float(config.CRAWLER_RATE_LIMIT_WINDOW)
    )
    max_requests: int = field(
        default_factory=lambda: config.CRAWLER_RATE_LIMIT_MAX_REQUESTS
    )

    _timestamps: deque = field(default_factory=deque, init=False, repr=False)
    _rate_limited_count: int = field(default=0, init=False, repr=False)
    _lock: threading.RLock = field(default_factory=threading.RLock, init=False, repr=False)
    _retry_strategy: RetryStrategy = field(
        default_factory=RetryStrategy, init=False, repr=False
    )

    def record_request(self) -> None:
        """Record that a request was made now."""
        with self._lock:
            now = time.monotonic()
            self._timestamps.append(now)
            self._purge_old(now)

    def record_429(self, attempt: int = 0) -> None:
        """
        Record an HTTP 429 response and block for the backoff delay.

        Args:
            attempt: How many 429s have been received for this request (0-indexed).
                     Drives exponential backoff.
        """
        with self._lock:
            self._rate_limited_count += 1
        delay = self._retry_strategy.delay_for(attempt)
        time.sleep(delay)

    def wait_if_needed(self) -> None:
        """Block if the domain has exceeded max_requests in the current window."""
        with self._lock:
            now = time.monotonic()
            self._purge_old(now)
            if len(self._timestamps) >= self.max_requests:
                # Oldest timestamp tells us when the window started; sleep until
                # enough time has passed for at least one slot to open.
                oldest = self._timestamps[0]
                sleep_for = self.window_seconds - (now - oldest)
                if sleep_for > 0:
                    time.sleep(sleep_for)

    @property
    def rate_limited_count(self) -> int:
        with self._lock:
            return self._rate_limited_count

    def _purge_old(self, now: float) -> None:
        """Remove timestamps outside the current window. Must hold lock."""
        cutoff = now - self.window_seconds
        while self._timestamps and self._timestamps[0] < cutoff:
            self._timestamps.popleft()
