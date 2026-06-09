# Crawler Integration: Fix Dependencies & Remove MockSource

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix Python crawler service pydantic dependency, verify it runs on port 5000, and remove MockSource fallback so the application depends exclusively on the real crawler for job data.

**Architecture:** The app currently has a two-tier job source strategy: attempt real crawler via CrawlerSource on port 5000, fall back to MockSource if unavailable. This plan eliminates the fallback, making the crawler mandatory. We fix the pydantic-core build issue in Python dependencies (likely a version constraint problem), verify the crawler service runs reliably, then systematically remove MockSource from the TypeScript codebase (manager registration, event handlers, tests, and file deletion).

**Tech Stack:** Python 3.14, Flask, Scrapy, pydantic (fixing version), TypeScript, Jest/Vitest for tests, MongoDB for job storage.

---

## File Structure

**Files to create:**
- None (reusing existing structure)

**Files to modify:**
- `crawler/requirements.txt` - Constrain pydantic version to avoid build failure
- `packages/api/src/job-sources/manager.ts` - Remove MockSource registration and fallback logic
- `packages/api/src/job-sources/__tests__/manager.test.ts` - Remove MockSource tests, update fallback tests
- `packages/api/src/job-sources/__tests__/e2e.test.ts` - Remove MockSource fallback scenarios
- `docs/FEATURES.md` - Update MockSource status from "MOCKED" to "REMOVED"
- `docs/ARCHITECTURE.md` - Remove MockSource mention (optional enhancement)

**Files to delete:**
- `packages/api/src/job-sources/mock-source.ts`
- `packages/api/src/job-sources/__tests__/mock-source.test.ts`

---

## Tasks

### Task 1: Fix Python Pydantic Dependency

**Files:**
- Modify: `crawler/requirements.txt`

**Context:** The `pydantic==2.7.1` requirement fails to build on Python 3.14 due to pydantic-core missing prebuilt wheels. Solution: upgrade to pydantic 2.9+ (latest stable) which has better Python 3.14 support.

- [ ] **Step 1: Update requirements.txt with compatible pydantic version**

In `crawler/requirements.txt`, change `pydantic==2.7.1` to `pydantic==2.9.2`.

Updated file:
```txt
# Web scraping
scrapy==2.16.0
beautifulsoup4==4.12.3

# HTTP server
flask==3.0.0

# Data validation
pydantic==2.9.2

# Redis integration (for future event-driven mode)
redis==5.0.4

# HTTP client
requests==2.31.0

# Environment variable management
python-dotenv==1.0.0

# Structured JSON logging
python-json-logger==2.0.7
```

- [ ] **Step 2: Clean old pip cache and install fresh**

```bash
cd /home/cda/dev/job-search/crawler
pip cache purge
pip install -q --no-cache-dir -r requirements.txt
```

Expected: No build errors, all packages install successfully (may take 1-2 min).

- [ ] **Step 3: Verify installation**

```bash
python3 -c "import pydantic; print(f'✅ pydantic {pydantic.__version__} installed')"
python3 -c "import scrapy; print('✅ scrapy installed')"
```

Expected output:
```
✅ pydantic 2.9.2 installed
✅ scrapy installed
```

- [ ] **Step 4: Test crawler server starts**

```bash
cd /home/cda/dev/job-search/crawler
timeout 10 python3 server.py &
sleep 3
curl http://localhost:5000/health 2>/dev/null && echo "✅ Crawler listening on 5000" || echo "❌ Failed"
pkill -f "python3 server.py"
```

Expected: `✅ Crawler listening on 5000`

- [ ] **Step 5: Commit**

```bash
cd /home/cda/dev/job-search
git add crawler/requirements.txt
git commit -m "fix(crawler): upgrade pydantic to 2.9.2 for Python 3.14 compatibility"
```

---

### Task 2: Remove MockSource from JobSourceManager

**Files:**
- Modify: `packages/api/src/job-sources/manager.ts`
- Test: `packages/api/src/job-sources/__tests__/manager.test.ts`

**Context:** The manager currently registers MockSource as a fallback. Remove its registration entirely so CrawlerSource is the only available source.

- [ ] **Step 1: Edit manager.ts to remove MockSource import and registration**

Remove import:
```typescript
import { MockSource } from './mock-source.js'
```

In constructor, change from:
```typescript
this.sources = [
  new CrawlerSource(),
  new MockSource(),
]
```

To:
```typescript
this.sources = [new CrawlerSource()]
```

- [ ] **Step 2: Update manager tests to remove MockSource assertions**

Remove test cases that check for MockSource registration. Update tests that expect 2 sources to expect 1 source.

Old test:
```typescript
it('should register all sources', () => {
  const manager = new JobSourceManager()
  expect(manager['sources'].length).toBe(2)
})
```

New test:
```typescript
it('should register CrawlerSource only', () => {
  const manager = new JobSourceManager()
  expect(manager['sources'].length).toBe(1)
  expect(manager['sources'][0]).toBeInstanceOf(CrawlerSource)
})
```

- [ ] **Step 3: Run tests to verify**

```bash
cd /home/cda/dev/job-search/packages/api
npm test -- --run src/job-sources/__tests__/manager.test.ts
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
cd /home/cda/dev/job-search
git add packages/api/src/job-sources/manager.ts
git add packages/api/src/job-sources/__tests__/manager.test.ts
git commit -m "refactor(job-sources): remove MockSource, make CrawlerSource mandatory"
```

---

### Task 3: Delete MockSource Files

**Files:**
- Delete: `packages/api/src/job-sources/mock-source.ts`
- Delete: `packages/api/src/job-sources/__tests__/mock-source.test.ts`

- [ ] **Step 1: Delete files**

```bash
cd /home/cda/dev/job-search
rm packages/api/src/job-sources/mock-source.ts
rm packages/api/src/job-sources/__tests__/mock-source.test.ts
```

- [ ] **Step 2: Verify no remaining MockSource imports**

```bash
grep -r "mock-source\|MockSource" packages/api/src --include="*.ts" --exclude-dir=node_modules
```

Expected: No output (no remaining references)

- [ ] **Step 3: Commit**

```bash
cd /home/cda/dev/job-search
git add -A
git commit -m "refactor(job-sources): delete mock-source.ts and tests"
```

---

### Task 4: Update Event Handlers to Remove Fallback Logic

**Files:**
- Modify: `packages/api/src/events/handlers.ts`

**Context:** Event handlers currently have fallback mechanism that logs "CrawlerSource failed completely, trying fallbacks...". Remove this fallback and let failures bubble up as errors.

- [ ] **Step 1: Find and update crawl_deeper handler**

Find the section where `JobSourceManager.scrapeWithDiscovery()` is called and add error handling that propagates failures instead of falling back to mock data.

Update to:
```typescript
const resultsManager = new JobSourceManager()
try {
  const results = await resultsManager.scrapeWithDiscovery(
    data.searchId,
    session.discoveredPages || [],
    session.query,
    2
  )
  
  await addEvent('jobs_scraped', {
    searchId: data.searchId,
    jobs: results.jobs,
    newSites: []
  })
} catch (error) {
  console.error('❌ Job scraping failed:', error)
  await addEvent('search_failed', {
    searchId: data.searchId,
    error: `Crawler error: ${String(error)}`
  })
}
```

- [ ] **Step 2: Remove fallback logs**

Remove any lines like:
```typescript
console.log('CrawlerSource failed completely, trying fallbacks...')
```

- [ ] **Step 3: Run integration tests**

```bash
cd /home/cda/dev/job-search/packages/api
npm test -- --run 2>&1 | grep -E "PASS|FAIL" | head -5
```

Expected: Tests run (may need updates in next task)

- [ ] **Step 4: Commit**

```bash
cd /home/cda/dev/job-search
git add packages/api/src/events/handlers.ts
git commit -m "refactor(events): remove fallback to MockSource in handlers"
```

---

### Task 5: Update E2E Tests to Remove Mock Scenarios

**Files:**
- Modify: `packages/api/src/job-sources/__tests__/e2e.test.ts`

**Context:** E2E tests have scenarios testing MockSource fallback behavior. Remove/update these.

- [ ] **Step 1: Remove tests that rely on MockSource fallback**

Remove test cases like:
- `'should provide fallback results when primary scrapers fail'`
- Any test expecting mock data as fallback

- [ ] **Step 2: Update tests that expect fallback behavior**

Old:
```typescript
it('should return results even if some sources timeout', async () => {
  const results = await manager.scrapeWithDiscovery(...)
  expect(results.jobs.length).toBeGreaterThan(0)
})
```

New:
```typescript
it('should fail cleanly if crawler is unavailable', async () => {
  await expect(
    manager.scrapeWithDiscovery(...)
  ).rejects.toThrow()
})
```

- [ ] **Step 3: Run e2e tests**

```bash
cd /home/cda/dev/job-search/packages/api
npm test -- --run src/job-sources/__tests__/e2e.test.ts 2>&1 | tail -10
```

Expected: Tests pass

- [ ] **Step 4: Commit**

```bash
cd /home/cda/dev/job-search
git add packages/api/src/job-sources/__tests__/e2e.test.ts
git commit -m "test(e2e): remove MockSource fallback test scenarios"
```

---

### Task 6: Update Documentation

**Files:**
- Modify: `docs/FEATURES.md`

**Context:** Update FEATURES.md to remove MockSource references and document the removal.

- [ ] **Step 1: Update MockSource status in FEATURES.md**

Find section "### MockSource Fallback" and change status from:
```markdown
- **Status:** 🟡 MOCKED (INTENTIONAL MOCK)
```

To:
```markdown
- **Status:** ❌ REMOVED
- **Details:**
  - Deleted from codebase entirely
  - Job discovery now depends exclusively on real Python Scrapy crawler
  - No fallback to mock data
  - Crawler service (port 5000) is mandatory
- **Removal Date:** 2026-06-09
```

- [ ] **Step 2: Update CrawlerSource error handling line**

Find section "### CrawlerSource - Python Service Integration" and update:

Old: `- Error Handling: Graceful fallback when crawler unavailable`
New: `- Error Handling: Strict - crawler errors propagate as search failures (no fallback)`

- [ ] **Step 3: Update Web Crawling intro**

Remove mention of fallback from Web Crawling section intro.

- [ ] **Step 4: Verify changes**

```bash
grep -n "fallback\|MockSource" /home/cda/dev/job-search/docs/FEATURES.md | head -5
```

Only "no fallback" references should appear.

- [ ] **Step 5: Commit**

```bash
cd /home/cda/dev/job-search
git add docs/FEATURES.md
git commit -m "docs: remove MockSource references, update for mandatory crawler"
```

---

### Task 7: Create Crawler Startup Guide

**Files:**
- Create: `CRAWLER_STARTUP.md`

**Context:** Document the required startup sequence for the crawler and API.

- [ ] **Step 1: Create startup guide**

Create `/home/cda/dev/job-search/CRAWLER_STARTUP.md`:

```markdown
# Crawler Startup Guide

The job-search application REQUIRES the Python crawler service to be running.

## Prerequisites

```bash
cd crawler
pip install -r requirements.txt
```

## Starting Services

### 1. Start Crawler (MUST be first)

```bash
cd /home/cda/dev/job-search/crawler
python3 server.py
# Verify: curl http://localhost:5000/health
```

### 2. Start Node API

In a new terminal:

```bash
cd /home/cda/dev/job-search/packages/api
export MONGODB_URI="mongodb://10.185.182.250:27017/job_search"
export REDIS_URL="redis://10.185.182.250:6379"
npm run dev
# Verify: curl http://localhost:3000/api/health
```

### 3. Start Frontend

In a new terminal:

```bash
cd /home/cda/dev/job-search/packages/frontend
npm run dev
# Open: http://localhost:5173
```

## Testing the Crawler

```bash
curl -X POST http://localhost:5000/crawler/scrape \
  -H "Content-Type: application/json" \
  -d '{"sites": ["https://www.linkedin.com/jobs"], "keywords": "engineer"}'
```

Expected: 200 with job data

## Troubleshooting

If crawler won't start:
1. Python 3.9+ installed: `python3 --version`
2. Dependencies installed: `pip show pydantic scrapy flask`
3. Port 5000 is free: `lsof -i :5000`

If `pydantic` build fails:
```bash
pip cache purge
pip install --no-cache-dir -r requirements.txt
```
```

- [ ] **Step 2: Commit**

```bash
cd /home/cda/dev/job-search
git add CRAWLER_STARTUP.md
git commit -m "docs: add crawler startup guide (mandatory service)"
```

---

### Task 8: End-to-End Integration Test

**Files:**
- Test: Full app workflow with real crawler

**Context:** Verify the entire system works with live crawler (no mock fallback).

- [ ] **Step 1: Ensure services start in correct order**

1. Start crawler on port 5000
2. Start API on port 3000
3. Verify both responding to health checks

- [ ] **Step 2: Test search workflow**

Create user, set Claude token, perform search for "software engineer"

- [ ] **Step 3: Verify no MockSource fallback**

Check API logs for any MockSource references or fallback logs. Should be empty.

- [ ] **Step 4: Verify crawler received request**

Check crawler logs show POST /crawler/scrape request and job data returned.

- [ ] **Step 5: Document results**

Commit with message noting successful integration test.

---

### Task 9: Final Verification & Cleanup

**Files:**
- Verify: No MockSource references remain
- Verify: All tests pass
- Verify: Documentation updated

- [ ] **Step 1: Search entire codebase for MockSource**

```bash
cd /home/cda/dev/job-search
grep -r "MockSource\|mock-source" packages/api/src --include="*.ts" | grep -v node_modules
```

Expected output: (nothing)

- [ ] **Step 2: Verify file deletion**

```bash
ls packages/api/src/job-sources/mock-source.ts 2>&1
```

Expected: `No such file or directory`

- [ ] **Step 3: Run full API test suite**

```bash
cd /home/cda/dev/job-search/packages/api
npm test -- --run 2>&1 | tail -5
```

Expected: All tests pass

- [ ] **Step 4: TypeScript type check**

```bash
cd /home/cda/dev/job-search
npm run build --workspace=@job-search/api 2>&1 | grep -i error | head -5
```

Expected: No errors related to MockSource

---

## Notes

- All tasks are independent after Task 1 (dependencies fixed)
- Tasks 2-6 remove MockSource from different layers
- Task 7 documents mandatory crawler service
- Task 8 validates integration
- Task 9 confirms cleanup
- Frequent commits enable easy rollback
