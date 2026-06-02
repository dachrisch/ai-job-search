# Crawler Service Integration Design

**Date:** 2026-06-02
**Status:** Validated

## Overview
Replace the existing Node.js-based `WebScraper` with a robust `CrawlerSource` that integrates with the Python-based job crawler service. This moves the extraction logic to a specialized Scrapy-based service capable of handling anti-bot measures, circuit breaking, and rate limiting.

## Architecture & Data Flow
The integration follows a "specialist" model where the Node.js API acts as the orchestrator and the Python service acts as the resilient executor.

1.  **Event Trigger:** The `crawl_requested` event receives a list of specific URLs from the `PageAnalyzer`.
2.  **Manager Dispatch:** `JobSourceManager` identifies `CrawlerSource` as the active provider and aggregates URLs and keywords into a `CrawlerRequest`.
3.  **HTTP Request:** `CrawlerSource` sends a `POST` request to `${CRAWLER_SERVICE_URL}/crawler/scrape`.
4.  **Resilient Execution:** The Python service handles per-domain circuit breaking and rate limiting, spawning Scrapy spiders to extract jobs.
5.  **Unified Response:** The Python service returns a JSON array, which `CrawlerSource` maps back to shared TypeScript types (`Job`, `ScrapingResult`).

## Component Design

### 1. Interface Refactoring
Update the `JobSource` interface in `packages/api/src/job-sources/interfaces.ts` to support bulk scraping:
-   `scrapeBulk(urls: string[], keywords: string, config?: JobSourceConfig): Promise<JobScraperResult[]>`
-   `canHandle(domain: string): boolean`

### 2. CrawlerSource Component
-   **Service URL:** Use `process.env.CRAWLER_SERVICE_URL` (fallback: `http://localhost:5000`).
-   **Payload Mapping:** Map internal data to Python `CrawlerRequest` format.
-   **Result Validation:** Ensure returned data conforms to our shared types.

### 3. Cleanup
-   Remove `packages/api/src/job-sources/web-scraper.ts` and its tests.
-   Remove domain whitelist checks from the API (delegated to the crawler service).

## Error Handling & Testing

### Error Handling
-   **Service Unavailable:** Catch timeouts (10s) and 500s, returning an empty `JobScraperResult` with an error message to allow the event flow to continue.
-   **Partial Success:** Handle per-site results and errors returned by the Python service.

### Testing
-   **Unit Tests:** Mock Axios in `crawler-source.test.ts` to test success, partial failure, and timeout scenarios.
-   **Integration Tests:** Update `discovery-integration.test.ts` to verify the full flow with a reachable crawler service or graceful fallback if unreachable.

## Observability
-   Pass `searchId` in all requests to the Python service to enable cross-service log correlation.
