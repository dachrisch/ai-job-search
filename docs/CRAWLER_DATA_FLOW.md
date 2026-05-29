# Crawler Data Flow & Integration

## Current State: Mock Data vs Real Crawler

### What Claude Currently Receives (Mock Data)

```
User Query: "Remote Python Developer"
         ↓
   [Search Created]
         ↓
   [Claude Processes]
         ↓
[Mock Job Data]
         ↓
   ┌─────────────────────────────────────────┐
   │ Senior Software Engineer                 │
   │ Company: TechCorp Inc.                  │
   │ Salary: $150,000 - $200,000             │
   │ Location: San Francisco, CA              │
   │ Description: 150+ chars...              │
   │ URL: https://techcorp.com/jobs/1       │
   │ Source: https://linkedin.com             │
   └─────────────────────────────────────────┘
   
   [Claude Ranks These Jobs]
         ↓
   ✅ 6 Jobs ranked with matchScore (95, 88, 82, etc)
```

### What Real Crawler Should Deliver

```
┌─────────────────────────────────────────────────────┐
│                  CRAWLER REQUEST                     │
├─────────────────────────────────────────────────────┤
│ searchId: "6a19e51ee82d696124d41c6d"                │
│ sites: ["linkedin.com", "indeed.com", "..."        │
│ keywords: "Remote Python Developer"                 │
│ config: { timeout: 15000, maxRetries: 2 }          │
└─────────────────────────────────────────────────────┘
              ↓ Crawler Executes ↓
        ┌─────────────────────────┐
        │ linkedin.com Scraper    │
        │ → Parse job listings    │
        │ → Extract fields        │
        │ → Remove duplicates     │
        │ → Return validated jobs │
        └─────────────────────────┘
              ↓
┌─────────────────────────────────────────────────────┐
│              CRAWLER RESPONSE                        │
├─────────────────────────────────────────────────────┤
│ [{                                                  │
│   "source": "linkedin.com",                         │
│   "jobs": [                                         │
│     {                                               │
│       "title": "Senior Python Developer",           │
│       "company": "Startup XYZ",                     │
│       "description": "Build scalable Python...",    │
│       "url": "https://linkedin.com/jobs/xyz",       │
│       "location": "Remote",                         │
│       "salary": "$110,000 - $150,000",              │
│       "sourceUrl": "https://linkedin.com"           │
│     },                                              │
│     ...more jobs...                                 │
│   ],                                                │
│   "errors": [],                                     │
│   "timestamp": "2026-05-29T19:12:30Z"               │
│ }]                                                  │
└─────────────────────────────────────────────────────┘
              ↓
         [API Receives]
              ↓
    [Stores in MongoDB]
              ↓
      [Claude Ranks All Jobs]
              ↓
    ✅ Returns Top 10 to User
```

## Event Flow with Real Crawler

```
1. User initiates search
   │
   └─→ search_started
       │
       └─→ SearXNG Search (find job board pages)
           │
           ├─ If results → pages_analyzed
           │              └─→ crawl_requested ◄────┐
           │                                        │
           └─ If no results → Claude suggests sites │
              └─→ sites_identified               │
                  └─→ crawl_requested ◄──────────┘
                      │
                      └─→ [CRAWLER CALLED HERE] ◄─────────────┐
                          │                                    │
                          ├─ Scrape each site                 │
                          ├─ Extract job data                 │
                          ├─ Validate structure               │
                          └─ Return jobs[]                    │
                              │                               │
                              └─→ jobs_scraped ────────────────┘
                                  │
                                  └─→ Store in MongoDB
                                      │
                                      └─→ search_evaluation
                                          │
                                          ├─ COMPLETE → search_complete
                                          ├─ REFINE   → search_refined
                                          └─ DEEPEN   → crawl_deeper
                                              │
                                              └─→ [CRAWLER CALLED AGAIN]
```

## Data Validation Rules

### Required Fields (Must Have)
```typescript
interface JobMinimum {
  title: string           // "Senior Python Developer"
  company: string         // "TechCorp Inc."
  description: string     // 50+ characters
  url: string            // Valid HTTPS URL
  location: string       // "Remote" or "City, State"
  sourceUrl: string      // "https://linkedin.com"
}
```

### Optional Fields (Nice to Have)
```typescript
interface JobOptional {
  salary?: string        // "$100,000 - $150,000"
  matchScore?: number    // 0-100 (Claude adds this)
  matchReasoning?: string // "Matches Python requirement" (Claude adds this)
}
```

### Validation Checklist

✅ URL is valid HTTPS format
✅ Description has 50+ characters
✅ Company name is non-empty
✅ Title is descriptive (10+ chars)
✅ Location is recognizable
✅ No duplicate URLs
✅ Response is JSON
✅ Error messages are clear

## Sample Crawler Response

### Success Response
```json
HTTP/1.1 200 OK

[
  {
    "source": "linkedin.com",
    "jobs": [
      {
        "title": "Senior Python Developer - Remote",
        "company": "TechCorp Inc",
        "description": "We're looking for an experienced Python developer to join our backend team. You'll work on distributed systems and APIs using Python, PostgreSQL, and Kubernetes.",
        "url": "https://linkedin.com/jobs/python-developer-12345",
        "location": "Remote",
        "salary": "$120,000 - $160,000",
        "sourceUrl": "https://linkedin.com"
      },
      {
        "title": "Python Backend Engineer",
        "company": "StartupXYZ",
        "description": "Join our team building the next generation of data platforms. Experience with Python, FastAPI, and cloud infrastructure required.",
        "url": "https://linkedin.com/jobs/backend-engineer-67890",
        "location": "Remote, US",
        "salary": "$100,000 - $140,000",
        "sourceUrl": "https://linkedin.com"
      }
    ],
    "errors": [],
    "timestamp": "2026-05-29T19:15:00Z"
  },
  {
    "source": "indeed.com",
    "jobs": [
      {
        "title": "Python Developer (Remote)",
        "company": "DataSystems Ltd",
        "description": "Seeking Python developer with 3+ years experience. Must have strong understanding of data structures and algorithms.",
        "url": "https://indeed.com/jobs/python-dev-abc123",
        "location": "Anywhere (Remote)",
        "salary": "$110,000 - $150,000",
        "sourceUrl": "https://indeed.com"
      }
    ],
    "errors": [],
    "timestamp": "2026-05-29T19:15:05Z"
  },
  {
    "source": "glassdoor.com",
    "jobs": [],
    "errors": [
      {
        "message": "Connection timeout after 15 seconds",
        "site": "glassdoor.com"
      }
    ],
    "timestamp": "2026-05-29T19:15:20Z"
  }
]
```

### Error Handling

```json
HTTP/1.1 200 OK  ← Still 200, partial success allowed

[
  {
    "source": "linkedin.com",
    "jobs": [ /* 5 jobs */ ],
    "errors": [],
    "timestamp": "2026-05-29T19:15:00Z"
  },
  {
    "source": "indeed.com",
    "jobs": [ /* 3 jobs */ ],
    "errors": [
      {
        "message": "JavaScript rendering failed",
        "site": "indeed.com"
      }
    ],
    "timestamp": "2026-05-29T19:15:05Z"
  },
  {
    "source": "glassdoor.com",
    "jobs": [],
    "errors": [
      {
        "message": "Rate limited: 429 Too Many Requests",
        "site": "glassdoor.com"
      }
    ],
    "timestamp": "2026-05-29T19:15:20Z"
  }
]
```

## Performance Expectations

### Timing
| Task | Duration |
|------|----------|
| Scrape single site | 3-5 seconds |
| Scrape 3 sites | 10-15 seconds |
| API request timeout | 30 seconds |
| Full search cycle | 20-60 seconds |

### Throughput
- **Jobs per site**: 5-20 minimum
- **Jobs per request**: 15-50 total
- **Maximum response size**: 5-10 MB
- **Deduplication**: Remove duplicate URLs

### Reliability
- **Retry policy**: Exponential backoff (1s, 2s, 4s)
- **Circuit breaker**: Skip site after 2 failures
- **Fallback**: Return mock data if crawler unavailable
- **Monitoring**: Log all errors and timeouts

## Integration Checklist

- [ ] Crawler accepts POST requests at correct endpoint
- [ ] Validates input (searchId, sites, keywords)
- [ ] Handles timeout gracefully (returns partial results)
- [ ] Returns proper JSON structure
- [ ] Includes error reporting
- [ ] Deduplicates URLs
- [ ] Validates job data before returning
- [ ] Respects rate limiting
- [ ] Includes timestamp on responses
- [ ] Logs activity for debugging

## Next Steps

1. **Design**: Crawler architecture and site-specific extractors
2. **Implement**: Python/Scrapy-based crawler service
3. **Test**: With sample job boards (LinkedIn, Indeed, Glassdoor)
4. **Integrate**: Connect to API via webhook/event queue
5. **Optimize**: Performance tuning and error handling
6. **Deploy**: Docker containerization and deployment

## References

- Sample mock data: `handlers.ts` (lines 11-76)
- Job interface: `interfaces.ts` (lines 1-11)
- Event flow: `handlers.ts` (crawl_requested handler)
- API endpoint: `routes/searches.ts`
