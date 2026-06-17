"""
Playwright-based network interceptor for SPA career pages.

When Scrapy returns 0 items from a career page, this module launches a
headless Chromium browser, navigates to the URL, and captures all JSON
XHR/fetch responses that look like job listing APIs.

The captured requests are returned to the API layer for one-time LLM
analysis to identify the endpoint pattern and field mapping.
"""

import asyncio
import json
import sys
import os

_crawler_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _crawler_root not in sys.path:
    sys.path.insert(0, _crawler_root)

from logger import get_logger
from config import CHROMIUM_EXECUTABLE_PATH

log = get_logger(__name__)

MAX_BODY_BYTES = 3000
MAX_CANDIDATES = 5
_JOB_LIST_KEYS = frozenset(
    ('jobs', 'postings', 'positions', 'results', 'data', 'items', 'requisitions')
)


def _looks_like_job_list(body: object) -> bool:
    if isinstance(body, list):
        return len(body) >= 2
    if isinstance(body, dict):
        for key in _JOB_LIST_KEYS:
            val = body.get(key)
            if isinstance(val, list) and len(val) >= 2:
                return True
    return False


async def capture_job_api_calls(url: str) -> list[dict]:
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        log.warning("playwright not installed; skipping network capture")
        return []

    captured: list[dict] = []

    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=CHROMIUM_EXECUTABLE_PATH)
        page = await browser.new_page()

        async def on_response(response):
            if len(captured) >= MAX_CANDIDATES:
                return
            if 'json' not in response.headers.get('content-type', ''):
                return
            try:
                body = await response.json()
            except Exception:
                return
            if not _looks_like_job_list(body):
                return
            captured.append({
                'url': response.url,
                'method': response.request.method,
                'response_body': json.dumps(body)[:MAX_BODY_BYTES],
                'response_status': response.status,
            })

        page.on('response', on_response)

        try:
            await page.goto(url, wait_until='networkidle', timeout=30000)
        except Exception as exc:
            log.warning(
                "Playwright navigation failed",
                extra={"url": url, "error": str(exc)},
            )

        await browser.close()

    log.info(
        "Network capture complete",
        extra={"url": url, "candidates": len(captured)},
    )
    return captured
