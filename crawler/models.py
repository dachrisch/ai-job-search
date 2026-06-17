"""
Pydantic v2 models for crawler service request/response validation.

Boundary convention
-------------------
All JSON-facing field names use camelCase (matching the Node.js API) via
alias_generator=to_camel. Internal Python code uses snake_case because
populate_by_name=True is enabled on every model.

Node.js type cross-references
------------------------------
- CrawlerRequest  ← payload Node.js sends to POST /crawler/scrape
- JobData         → mirrors Job in packages/shared/src/types.ts
- SiteResult      → mirrors JobScraperResult in packages/api/src/job-sources/interfaces.ts
- CrawlerResponse → serialises as JSON array of SiteResult objects
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field, RootModel, field_validator
from pydantic.alias_generators import to_camel


# ---------------------------------------------------------------------------
# Shared model config
# ---------------------------------------------------------------------------

_CAMEL_CONFIG = ConfigDict(
    alias_generator=to_camel,
    populate_by_name=True,   # accept both snake_case and camelCase on input
    str_strip_whitespace=True,
)


# ---------------------------------------------------------------------------
# CrawlerConfig — per-request timeout / retry overrides
# ---------------------------------------------------------------------------

class CrawlerConfig(BaseModel):
    """Optional overrides for CRAWLER_TIMEOUT and CRAWLER_MAX_RETRIES."""

    model_config = _CAMEL_CONFIG

    timeout: Optional[int] = Field(
        default=None,
        ge=1,
        le=300,
        description="Per-site request timeout in seconds (overrides CRAWLER_TIMEOUT env var)",
    )
    max_retries: Optional[int] = Field(
        default=None,
        ge=0,
        le=10,
        description="Max retries per failed request (overrides CRAWLER_MAX_RETRIES env var)",
    )


# ---------------------------------------------------------------------------
# CrawlerRequest — payload sent by the Node.js API to POST /crawler/scrape
# ---------------------------------------------------------------------------

class CrawlerRequest(BaseModel):
    """Validated incoming request from the Node.js API."""

    model_config = _CAMEL_CONFIG

    search_id: str = Field(
        description="UUID correlation ID tying this crawl to a SearchSession document",
    )
    sites: list[str] = Field(
        description="Domain list to crawl, e.g. ['linkedin.com', 'indeed.com']",
    )
    keywords: str = Field(
        description="Natural-language search query forwarded to each site",
    )
    config: CrawlerConfig = Field(
        default_factory=CrawlerConfig,
        description="Optional timeout / retry overrides",
    )

    @field_validator("search_id")
    @classmethod
    def search_id_non_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("searchId must not be empty")
        return v

    @field_validator("sites")
    @classmethod
    def sites_non_empty(cls, v: list[str]) -> list[str]:
        if not v:
            raise ValueError("sites list must contain at least one domain")
        cleaned = [s.strip() for s in v if s.strip()]
        if not cleaned:
            raise ValueError("sites list contains only blank entries")
        return cleaned

    @field_validator("keywords")
    @classmethod
    def keywords_non_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("keywords must not be empty")
        return v


# ---------------------------------------------------------------------------
# JobData — a single scraped job listing
# ---------------------------------------------------------------------------

class JobData(BaseModel):
    """
    A validated job listing.

    Field names are snake_case internally; they serialise to camelCase via
    alias_generator=to_camel so the output matches the Node.js Job interface.
    """

    model_config = _CAMEL_CONFIG

    title: str = Field(description="Job title (minimum 10 characters)")
    company: str = Field(description="Hiring company name")
    description: str = Field(description="Job description text (minimum 50 characters)")
    url: str = Field(description="Direct HTTPS URL to the job listing")
    location: str = Field(description="Job location or 'Remote'")
    salary: Optional[str] = Field(
        default=None,
        description="Salary range if published by the job board",
    )
    source_url: str = Field(
        description="HTTPS URL of the job board page that was scraped",
    )

    @field_validator("title")
    @classmethod
    def title_min_length(cls, v: str) -> str:
        if len(v) < 10:
            raise ValueError(
                f"title must be at least 10 characters, got {len(v)}: {v!r}"
            )
        return v

    @field_validator("company")
    @classmethod
    def company_non_empty(cls, v: str) -> str:
        if not v:
            raise ValueError("company must not be empty")
        return v

    @field_validator("description")
    @classmethod
    def description_min_length(cls, v: str) -> str:
        if len(v) < 50:
            raise ValueError(
                f"description must be at least 50 characters, got {len(v)}"
            )
        return v

    @field_validator("url", "source_url")
    @classmethod
    def url_must_be_https(cls, v: str) -> str:
        if not v.startswith("https://"):
            raise ValueError(
                f"URL must begin with 'https://', got: {v!r}"
            )
        return v

    @field_validator("location")
    @classmethod
    def location_non_empty(cls, v: str) -> str:
        if not v:
            raise ValueError("location must not be empty")
        return v


# ---------------------------------------------------------------------------
# SiteResult — results from scraping one job board domain
# ---------------------------------------------------------------------------

class SiteResult(BaseModel):
    """
    All jobs and errors collected from a single job board URL.

    Mirrors JobScraperResult in packages/api/src/job-sources/interfaces.ts:
        { jobs, errors, source, timestamp }
    """

    model_config = _CAMEL_CONFIG

    source: str = Field(description="Domain or name of the job board that was scraped")
    jobs: list[JobData] = Field(default_factory=list)
    errors: list[dict[str, Any]] = Field(
        default_factory=list,
        description="Error records; each dict must have at least 'message' and 'site' keys",
    )
    timestamp: str = Field(
        description="ISO 8601 UTC timestamp marking when this site's scrape completed",
    )

    @staticmethod
    def utc_now_iso() -> str:
        """Return the current UTC time as an ISO 8601 string with milliseconds."""
        now = datetime.now(timezone.utc)
        # Format: 2026-05-29T14:23:01.456Z
        return now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"


# ---------------------------------------------------------------------------
# CompanyCrawlRequest — payload for crawling a single company career page
# ---------------------------------------------------------------------------

class CompanyCrawlRequest(BaseModel):
    """Request to crawl a specific company career page."""

    model_config = _CAMEL_CONFIG

    search_id: str = Field(
        description="UUID correlation ID tying this crawl to a SearchSession"
    )
    company_id: str = Field(
        description="MongoDB ObjectId of the Company being crawled"
    )
    url: str = Field(
        description="Full URL of the company career page (https://...)"
    )
    company_name: str = Field(
        description="Company name for logging/tracking"
    )
    query: str = Field(
        description="Original user search query for context"
    )

    @field_validator("url")
    @classmethod
    def url_must_be_https(cls, v: str) -> str:
        if not v.startswith("https://"):
            raise ValueError("URL must start with https://")
        return v


# ---------------------------------------------------------------------------
# CompanyCrawlResult — result from crawling a single company career page
# ---------------------------------------------------------------------------

class CompanyCrawlResult(BaseModel):
    """Result from crawling a single company career page."""

    model_config = _CAMEL_CONFIG

    search_id: str
    company_id: str
    jobs: list[JobData] = Field(default_factory=list)
    discovered_companies: list[dict[str, Any]] = Field(
        default_factory=list,
        description="Other companies mentioned on this company's page"
    )
    errors: list[dict[str, Any]] = Field(default_factory=list)
    unsupported: bool = Field(
        default=False,
        description="True when the crawl completed but no jobs could be extracted (no adapter matched and the generic spider found nothing)"
    )
    timestamp: str = Field(default_factory=SiteResult.utc_now_iso)


# ---------------------------------------------------------------------------
# CrawlerResponse — the complete response body returned to the Node.js API
# ---------------------------------------------------------------------------

class CrawlerResponse(RootModel[list[SiteResult]]):
    """
    Serialises as a JSON array of SiteResult objects.

    Usage:
        response = CrawlerResponse(root=site_results)
        return jsonify(response.to_list()), 200
    """

    def to_list(self) -> list[dict[str, Any]]:
        """Return a plain list of dicts using camelCase aliases, ready for jsonify()."""
        return [site.model_dump(by_alias=True) for site in self.root]


# ---------------------------------------------------------------------------
# Conversion helper
# ---------------------------------------------------------------------------

def scrapy_item_to_job_data(item: dict[str, Any]) -> Optional[JobData]:
    """
    Convert a Scrapy JobItem (serialised as a plain dict) to a validated JobData.

    Scrapy's JobItem uses snake_case field names (source_url) which match
    JobData's Python attribute names exactly, so model_validate works without
    any field remapping.

    Returns None — rather than raising — when an item fails validation so
    the caller can count and log failures without aborting the entire batch.

    Args:
        item: A plain dict from ``dict(scrapy_job_item)``.

    Returns:
        A validated ``JobData`` instance, or ``None`` if validation fails.

    Example:
        job = scrapy_item_to_job_data(dict(scrapy_item))
        if job is None:
            log.warning("Dropping invalid item", extra={"item": item})
    """
    try:
        return JobData.model_validate(item)
    except Exception:
        return None
