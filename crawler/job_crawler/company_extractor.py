"""
Company extraction utilities for discovering new job sources.

This module extracts:
  1. Career page URLs found in HTML content (for crawler optimization)
  2. Company names from page text (for identifying sister companies, subsidiaries)

Usage:
    from job_crawler.company_extractor import (
        extract_discovered_companies,
        extract_company_name_from_url,
    )

    companies = extract_discovered_companies(html, current_url)
    # Returns: [{"name": "Acme Corp", "url": "https://acme.com/careers"}, ...]

    name = extract_company_name_from_url("https://example-corp.com")
    # Returns: "Example Corp"
"""

import re
from typing import Optional
from urllib.parse import urlparse, urljoin


def extract_discovered_companies(
    html_content: str, current_url: str
) -> list[dict[str, Optional[str]]]:
    """
    Extract career page URLs and company mentions from HTML content.

    Searches for:
      1. Links to /careers, /jobs, /careers/jobs, /join-us, /hiring URLs
      2. Text mentions of sister companies, subsidiaries, or related companies

    Args:
        html_content: The HTML page content to search.
        current_url: The URL of the page (for resolving relative links).

    Returns:
        A list of dicts with keys:
          - name: Company name (extracted from URL or text)
          - url: Career page URL (if found)
          - location: Optional location hint from text

        Results are deduplicated by company name.

    Example:
        >>> html = '''
        ... <a href="/careers">Join our team</a>
        ... <p>Sister company: Example Corp</p>
        ... '''
        >>> extract_discovered_companies(html, "https://site.com/about")
        [
            {"name": "Site", "url": "https://site.com/careers"},
            {"name": "Example Corp", "url": None, "location": None}
        ]
    """
    companies: dict[str, dict[str, Optional[str]]] = {}

    # Extract career page URLs
    # Patterns: /careers, /jobs, /careers/jobs, /join-us, /hiring, /work-with-us, etc.
    career_url_patterns = [
        r'href=["\']([^"\']*?(?:/careers|/jobs|/careers/jobs|/join-us|/hiring|/work-with-us)[^"\']*)["\']',
        r'href=["\']([^"\']*?(?:careers|jobs|hiring)\.(?:com|org|io|co))["\']',
    ]

    for pattern in career_url_patterns:
        for match in re.finditer(pattern, html_content, re.IGNORECASE):
            raw_url = match.group(1)
            # Resolve relative URLs
            absolute_url = urljoin(current_url, raw_url)

            # Extract company name from URL
            company_name = extract_company_name_from_url(absolute_url)
            if company_name:
                if company_name not in companies:
                    companies[company_name] = {
                        "name": company_name,
                        "url": absolute_url,
                        "location": None,
                    }
                else:
                    # Update URL if we found a more specific one
                    if "/careers" in absolute_url or "/jobs" in absolute_url:
                        companies[company_name]["url"] = absolute_url

    # Extract text mentions of sister companies and subsidiaries
    # Pattern: "sister company: X", "subsidiary: Y", "join X", etc.
    sister_company_patterns = [
        r'sister\s+compan(?:y|ies)\s*:?\s*([A-Z][A-Za-z\s&,]+?)(?:[.,!]|and|or|\s{2,}|$)',
        r'subsidiar(?:y|ies)\s*:?\s*([A-Z][A-Za-z\s&,]+?)(?:[.,!]|and|or|\s{2,}|$)',
        r'(?:join|owned by|operated by|parent company|part of)\s+([A-Z][A-Za-z\s&,]+?)(?:\s+group)?(?:[.,!]|\s{2,}|$)',
        r'([A-Z][A-Za-z\s&,]+?)\s+(?:is\s+)?(?:our\s+)?sister\s+compan(?:y|ies)',
    ]

    for pattern in sister_company_patterns:
        for match in re.finditer(pattern, html_content):
            raw_company_name = match.group(1).strip()
            # Clean up the company name (remove trailing "and", "or", etc.)
            company_name = re.sub(
                r'\s+(?:and|or)\s+.*$', "", raw_company_name, flags=re.IGNORECASE
            ).strip()

            # Skip very short matches (likely false positives)
            if len(company_name) < 3:
                continue

            # Avoid duplicates; only add if not already found as URL-extracted company
            if company_name not in companies:
                companies[company_name] = {
                    "name": company_name,
                    "url": None,
                    "location": None,
                }

    return list(companies.values())


def extract_company_name_from_url(url: str) -> str:
    """
    Extract a human-readable company name from a URL.

    Transforms:
      - https://example-corp.com → "Example Corp"
      - https://careers.acme.org → "Acme"
      - https://jobs_employer.io → "Employer"
      - https://my_company.co.uk → "My Company"

    Args:
        url: The URL to extract the company name from.

    Returns:
        A capitalized company name, or empty string if extraction fails.

    Example:
        >>> extract_company_name_from_url("https://example-corp.com/careers")
        "Example Corp"
        >>> extract_company_name_from_url("https://jobs.acme.org")
        "Acme"
    """
    if not url:
        return ""

    try:
        parsed = urlparse(url)
        domain = parsed.netloc.lower() or parsed.path.lower()

        # Remove common prefixes (www, jobs, careers, etc.)
        domain = re.sub(r"^(?:www\.|jobs\.|careers\.)", "", domain)

        # Extract the main domain part (before the first dot or TLD)
        # Match: subdomain.example.com or example.com
        match = re.search(r"^([a-z0-9_-]+)(?:\.[a-z0-9_-]+)*(?:\.[a-z]{2,})?$", domain)
        if not match:
            return ""

        name_part = match.group(1)

        # Remove common TLDs and ccTLDs that might be stuck to the name
        name_part = re.sub(
            r"(?:com|org|io|co|net|edu|gov|biz|info|us|uk|de|fr|jp)$",
            "",
            name_part,
            flags=re.IGNORECASE,
        )

        # Replace hyphens and underscores with spaces for word separation
        name_part = re.sub(r"[-_]", " ", name_part)

        # Capitalize each word
        company_name = " ".join(word.capitalize() for word in name_part.split())

        return company_name if company_name else ""

    except Exception:
        # On any parsing error, return empty string
        return ""
