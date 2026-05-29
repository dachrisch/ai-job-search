"""
Structured logger for the crawler service.

Usage
-----
    from logger import get_logger, set_request_id

    # At the top of a request handler, set the correlation ID:
    set_request_id("search-abc123")

    log = get_logger(__name__)
    log.info("Scraping started", extra={"url": "https://example.com/jobs"})

Output (LOG_FORMAT=json)
------------------------
    {
      "timestamp": "2026-05-29T14:23:01.456Z",
      "level": "INFO",
      "component": "server",
      "request_id": "search-abc123",
      "message": "Scraping started",
      "url": "https://example.com/jobs"
    }

Output (LOG_FORMAT=text)
------------------------
    2026-05-29T14:23:01.456Z INFO  [search-abc123] server: Scraping started url=https://example.com/jobs
"""

import logging
import sys
from contextvars import ContextVar
from typing import Any

from pythonjsonlogger import jsonlogger  # type: ignore[import-untyped]

from config import LOG_FORMAT, LOG_LEVEL

# ---------------------------------------------------------------------------
# Request-ID context variable
# ---------------------------------------------------------------------------

# Stores the current request/search correlation ID.
# ContextVar is thread-safe and async-safe; each concurrent request gets its
# own value without explicit passing through call stacks.
_request_id_var: ContextVar[str] = ContextVar("request_id", default="-")


def set_request_id(request_id: str) -> None:
    """Set the correlation ID for the current execution context."""
    _request_id_var.set(request_id)


def get_request_id() -> str:
    """Return the correlation ID for the current execution context."""
    return _request_id_var.get()


# ---------------------------------------------------------------------------
# Custom log record factory
# ---------------------------------------------------------------------------

_original_factory = logging.getLogRecordFactory()


def _record_factory(*args: Any, **kwargs: Any) -> logging.LogRecord:
    record = _original_factory(*args, **kwargs)
    record.request_id = get_request_id()  # type: ignore[attr-defined]
    return record


logging.setLogRecordFactory(_record_factory)


# ---------------------------------------------------------------------------
# Formatters
# ---------------------------------------------------------------------------

class _JsonFormatter(jsonlogger.JsonFormatter):
    """JSON formatter that always includes timestamp, level, component, and request_id."""

    def add_fields(
        self,
        log_record: dict[str, Any],
        record: logging.LogRecord,
        message_dict: dict[str, Any],
    ) -> None:
        super().add_fields(log_record, record, message_dict)
        log_record["timestamp"] = self.formatTime(record, "%Y-%m-%dT%H:%M:%S")
        log_record["level"] = record.levelname
        log_record["component"] = record.name
        log_record["request_id"] = getattr(record, "request_id", "-")
        # Remove redundant default fields added by the base class
        log_record.pop("levelname", None)
        log_record.pop("name", None)


_TEXT_FORMAT = (
    "%(asctime)s %(levelname)-5s [%(request_id)s] %(name)s: %(message)s"
)
_TEXT_DATE_FORMAT = "%Y-%m-%dT%H:%M:%S"


# ---------------------------------------------------------------------------
# Root handler setup (called once at import time)
# ---------------------------------------------------------------------------

def _configure_root_logger() -> None:
    root = logging.getLogger()
    if root.handlers:
        # Already configured (e.g. by Flask or pytest); don't add duplicate handlers.
        return

    handler = logging.StreamHandler(sys.stdout)

    if LOG_FORMAT == "json":
        handler.setFormatter(
            _JsonFormatter(
                fmt="%(timestamp)s %(level)s %(component)s %(request_id)s %(message)s"
            )
        )
    else:
        handler.setFormatter(
            logging.Formatter(fmt=_TEXT_FORMAT, datefmt=_TEXT_DATE_FORMAT)
        )

    root.addHandler(handler)
    root.setLevel(getattr(logging, LOG_LEVEL, logging.INFO))

    # Silence noisy third-party loggers at WARNING unless we're in DEBUG.
    for noisy in ("scrapy", "urllib3", "werkzeug"):
        logging.getLogger(noisy).setLevel(
            logging.DEBUG if LOG_LEVEL == "DEBUG" else logging.WARNING
        )


_configure_root_logger()


# ---------------------------------------------------------------------------
# Public factory
# ---------------------------------------------------------------------------

def get_logger(name: str) -> logging.Logger:
    """
    Return a logger for the given module name.

    Args:
        name: Typically ``__name__`` of the calling module.

    Returns:
        A standard ``logging.Logger`` that emits structured output.
    """
    return logging.getLogger(name)
