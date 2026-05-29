# Job Search Crawler Specification

## Overview

The crawler is a critical component that extracts job listings from job boards and websites. It receives requests from the event-driven API and returns structured job data that Claude AI ranks and filters.

## Current Data Flow

```
Event: crawl_requested
├─ Input: { searchId, sites[], keywords }
├─ Process: Scrape job boards
└─ Output: jobs_scraped event
   └─ { searchId, jobs[], newSites[] }
       └─ Each job is ranked by Claude
           └─ Search complete
```

## Job Data Structure

### Input: What Crawler Receives

```json
{
  "searchId": "6a19e51ee82d696124d41c6d",
  "sites": ["linkedin.com", "indeed.com", "glassdoor.com"],
  "keywords": "Remote Python Developer",
  "config": {
    "timeout": 15000,
    "maxRetries": 2
  }
}
```

### Output: What Crawler Must Return

```json
{
  "source": "linkedin.com",
  "jobs": [
    {
      "title": "Senior Python Developer",
      "company": "TechCorp Inc.",
      "description": "We are seeking an experienced Python developer...",
      "url": "https://linkedin.com/jobs/12345",
      "location": "Remote",
      "salary": "$120,000 - $160,000",
      "sourceUrl": "https://linkedin.com"
    }
  ],
  "errors": [],
  "timestamp": "2026-05-29T19:12:30Z"
}
```

## Crawler Requirements

### 1. **Job Extraction Fields** (Required)
- `title` - Job title (string)
- `company` - Company name (string)
- `description` - Job description/requirements (string, 200+ chars recommended)
- `url` - Direct link to job posting (string, must be valid URL)
- `location` - Job location (string, e.g., "Remote", "San Francisco, CA")
- `sourceUrl` - Job board URL/domain (string)

### 2. **Job Extraction Fields** (Optional but valuable)
- `salary` - Salary range (string, e.g., "$120,000 - $160,000")

### 3. **Error Handling**
Return errors array for each job board that fails:
```json
{
  "errors": [
    {
      "message": "Connection timeout after 15 seconds",
      "site": "linkedin.com"
    }
  ]
}
```

### 4. **Performance Requirements**
- **Timeout**: Must respect 15-30 second timeout per site
- **Max Retries**: 2 attempts on failure
- **Batch Size**: Process 5-20 jobs per site minimum
- **Deduplication**: Remove duplicate URLs within response

## Crawler Interface Proposal

### HTTP Endpoint (REST API)

**Endpoint**: `POST /crawler/scrape`

**Request**:
```json
{
  "searchId": "6a19e51ee82d696124d41c6d",
  "sites": ["linkedin.com", "indeed.com", "glassdoor.com"],
  "keywords": "Remote Python Developer",
  "config": {
    "timeout": 15000,
    "maxRetries": 2,
    "userAgent": "Mozilla/5.0..."
  }
}
```

**Response**:
```json
[
  {
    "source": "linkedin.com",
    "jobs": [...],
    "errors": [],
    "timestamp": "2026-05-29T19:12:30Z"
  },
  {
    "source": "indeed.com",
    "jobs": [...],
    "errors": [],
    "timestamp": "2026-05-29T19:12:35Z"
  }
]
```

**Status Codes**:
- `200` - Successfully scraped (even if some sites had errors)
- `408` - Request timeout
- `429` - Rate limited
- `500` - Fatal error

### Event Queue Integration (Async)

The crawler can also be integrated via BullMQ for async processing:

```typescript
// API Server emits event
await addEvent('crawl_requested', {
  searchId: searchId,
  sites: ['linkedin.com', 'indeed.com'],
  keywords: 'Remote Python Developer'
})

// Crawler service listens to events and processes asynchronously
// When done, posts results back via HTTP webhook:
POST http://api:3000/api/crawler/results
{
  "searchId": "...",
  "jobs": [...],
  "newSites": [...]
}
```

## Crawler Implementation Strategy

### Recommended Architecture

1. **Python-based** (Scrapy framework)
   - Async request handling
   - Built-in deduplication
   - Middleware support for headers/proxies
   
2. **Site-Specific Extractors**
   - LinkedIn extractor (handles JavaScript rendering)
   - Indeed extractor (parse HTML structure)
   - Glassdoor extractor (parse JSON APIs)
   - Generic fallback (CSS selectors)

3. **Job Board Detection**
   - Auto-detect job board type from domain
   - Route to appropriate extractor
   - Fallback to generic extraction

### Extraction Strategy

```python
# Pseudo-code for extraction logic

for job_element in page.select('.job-listing'):
    job = {
        'title': job_element.select('.job-title::text').get(),
        'company': job_element.select('.company-name::text').get(),
        'description': job_element.select('.job-description::text').get(),
        'url': job_element.select('a.job-link::attr(href)').get(),
        'location': job_element.select('.location::text').get(),
        'salary': job_element.select('.salary::text').get(),
        'sourceUrl': domain
    }
    
    if all([job['title'], job['company'], job['url']]):
        jobs.append(job)
```

## Data Quality Metrics

### Validation Rules

✅ **Valid Job Entry**
```json
{
  "title": "Senior Python Developer",
  "company": "TechCorp Inc.",
  "description": "Looking for an experienced...",
  "url": "https://example.com/job/12345",
  "location": "Remote",
  "sourceUrl": "https://linkedin.com"
}
```

❌ **Invalid Job Entry** (missing required fields)
```json
{
  "title": "Senior Python Developer",
  // Missing: company, description, url, sourceUrl
}
```

### Quality Scoring
- **URL Format**: Valid HTTPS URL (required)
- **Description Length**: 50+ characters (required)
- **Company Name**: Non-empty (required)
- **Location**: Recognized format (optional)
- **Salary**: Present and parseable (bonus)

## Integration Points

### 1. API → Crawler Communication
- **Method**: REST HTTP POST
- **Queue**: BullMQ with Redis backing
- **Retry Logic**: Automatic retry on 5xx errors
- **Timeout**: 30 seconds total per request

### 2. Crawler → API Communication
- **Results Webhook**: `POST /api/crawler/results`
- **Status Updates**: Via SSE if WebSocket available
- **Error Reporting**: Included in response

### 3. Data Storage
- Jobs stored in MongoDB
- Deduplication by URL (unique index)
- Search session association
- Ranking performed by Claude AI

## Example: What Claude Sees

When the crawler returns 3 jobs for "Remote Python Developer":

```json
{
  "source": "indeed.com",
  "jobs": [
    {
      "title": "Remote Python Developer",
      "company": "StartupXYZ",
      "description": "Build scalable Python applications...",
      "url": "https://indeed.com/jobs/1",
      "location": "Remote",
      "salary": "$100,000 - $130,000",
      "sourceUrl": "https://indeed.com"
    }
  ]
}
```

Claude AI then:
1. Extracts this to MongoDB Job collection
2. Calculates `matchScore` (0-100)
3. Provides `matchReasoning` (why it matches)
4. Returns ranked results to user

## Roadmap

### Phase 1: Foundation
- [ ] Implement basic HTTP crawler service
- [ ] Support LinkedIn, Indeed, Glassdoor
- [ ] Return structured job data
- [ ] Error handling and retries

### Phase 2: Enhancement
- [ ] Add more job boards (AngelList, StackOverflow, etc.)
- [ ] JavaScript rendering support (Puppeteer/Playwright)
- [ ] Smarter text extraction (ML-based)
- [ ] Caching and deduplication

### Phase 3: Optimization
- [ ] Rate limit handling
- [ ] Proxy rotation
- [ ] Geographic targeting
- [ ] Real-time job alerts

### Phase 4: Intelligence
- [ ] Claude feedback loop (learn from rankings)
- [ ] Job board-specific optimizations
- [ ] Predictive crawling
- [ ] Cost optimization

## References

- **Job Interface**: `packages/api/src/job-sources/interfaces.ts`
- **Event Handlers**: `packages/api/src/events/handlers.ts`
- **Event Queue**: `packages/api/src/events/queue.ts`
- **Sample Data**: See `getMockJobs()` in handlers.ts for expected structure
