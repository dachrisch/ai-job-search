# Job Search Platform - Architecture Documentation

## System Overview

The Job Search Platform is a modular, event-driven system that enables intelligent job discovery through AI-powered search and web crawling.

> **⚠️ Current direction (2026-06-19): layered job sources.** Job discovery is being
> migrated from the company/ATS-adapter crawl model to a **layered, query-based source
> architecture**. A `SourceManager` (`packages/api/src/sources/`) fans a query out to
> multiple sources in parallel, merges, and dedupes by URL; results join the existing
> `jobs_extracted → Claude scoring → SSE → frontend` pipeline unchanged.
>
> - **Tier 1 — free job APIs** (breadth). Live: `ArbeitsagenturSource` (Bundesagentur für
>   Arbeit "Jobsuche" API; shipped v0.6.0; jobs stored with `discoveryMethod:'arbeitsagentur'`).
> - **Tier 2 — SearXNG + opencode agent discovery** (long tail / hidden gems). Live: `SearchSourceManager` runs an iterative hidden-gem discovery loop (opencode proposes queries → SearXNG paginated search → classify + score → prioritize).
> - **Tier 3 — durable JSON ATS adapters** (Greenhouse/Lever/Personio/Ashby). Planned.
>
> Full design: `docs/superpowers/specs/2026-06-19-layered-job-source-strategy-design.md`.
> The sections below describe the **legacy** company-centric / job-board pipelines, which
> are being retired as the tiers land.

### 5-Step Job Discovery Process (legacy pipeline)

1. **User Initiates Search** - User submits job search query through the React frontend
2. **Search Session Created** - API creates a new search session and emits `search_started` event to the event queue
3. **opencode Discovery** - The opencode agent proposes diverse SearXNG queries biased toward hidden-gem employers, the backend runs them, and the agent classifies + scores company career pages
4. **Web Crawling** - Crawler extracts job listings from the discovered company pages
5. **Job Ranking & Storage** - Extracted jobs are evaluated by opencode, ranked by match score, and stored in MongoDB

## System Components

### Frontend (React)

**Technology Stack:**
- React 19.2.6
- TypeScript
- Vite build tool
- Custom hooks: `useAuth`, `useSearch`

**Responsibilities:**
- User registration and login
- Search query interface
- Results display with ranking visualization
- Real-time search status polling

**Key Files:**
- `src/pages/SearchPage.tsx` - Main search interface
- `src/pages/ResultsPage.tsx` - Results display with ranked jobs
- `src/hooks/useSearch.ts` - Search management
- `src/hooks/useAuth.ts` - Authentication state

---

### API Server (Express.js)

**Technology Stack:**
- Express.js 5.2.1
- TypeScript
- Node.js 20.x
- MongoDB with Mongoose ORM
- JWT authentication

**Responsibilities:**
- User authentication and JWT token management
- Search session management
- Job data retrieval and ranking
- API gateway for crawler integration
- Event queue coordination

**Key Routes:**
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User authentication
- `POST /api/searches` - Create search session
- `GET /api/searches/{searchId}` - Get search status
- `GET /api/searches/{searchId}/jobs` - Retrieve ranked jobs
- `GET /api/health` - Health check

**Key Files:**
- `src/auth/auth.controller.ts` - Authentication logic
- `src/routes/auth.ts` - Auth endpoints
- `src/routes/searches.ts` - Search endpoints
- `src/db/models.ts` - MongoDB schemas
- `src/events/queue.ts` - BullMQ integration
- `src/events/handlers.ts` - Event processing

---

### Event Queue (BullMQ + Redis)

**Technology Stack:**
- BullMQ (Bull queue for Node.js)
- Redis 8.6.3
- TypeScript

**Responsibilities:**
- Asynchronous event processing
- Decoupling frontend requests from long-running operations
- Job status tracking and recovery

**Event Types:**
- `search_started` - Triggered when user creates new search
- `companies_discovered` - opencode-driven SearXNG discovery found companies
- `crawl_company` / `company_crawled` - Crawler extracts a company's jobs
- `jobs_extracted` - opencode scores the extracted jobs
- `results_ready_for_frontend` - Scored jobs broadcast over SSE

**Key Files:**
- `src/events/queue.ts` - Queue configuration and event publishing
- `src/events/handlers.ts` - Event handler implementations

---

### opencode AI Client

**Technology Stack:**
- opencode agent API (code.lehel.xyz)
- HTTP client: session create → prompt → poll for reply
- Model tiers with retry + failover

**Responsibilities:**
- Hidden-gem query generation and search refinement
- Company career-page classification and scoring
- Job evaluation and ranking
- Match score calculation with reasoning

**Key Files:**
- `src/ai/opencode.ts` - opencode session client
- `src/ai/llm.ts` - `callLLM` / `callLLMJson` facade

---

### Web Crawler (Scrapy)

**Technology Stack:**
- Scrapy framework
- Python 3.9+
- BeautifulSoup for HTML parsing
- Flask for HTTP endpoint
- Redis for request deduplication

**Responsibilities:**
- Discover job boards from search results
- Extract job listings with title, company, salary, location
- Filter jobs by keywords and location
- Prevent duplicate scraping with Redis cache

**Key Files:**
- `crawler/job_crawler/spiders/` - Scrapy spiders
- `crawler/cli.py` - CLI interface for crawling
- `crawler/server.py` - Flask HTTP endpoint
- `crawler/requirements.txt` - Python dependencies

**Endpoint:**
```
POST /crawler/scrape
{
  "urls": ["https://example.com/jobs"],
  "keywords": ["Python", "Remote"]
}
```

---

### Database (MongoDB)

**Technology Stack:**
- MongoDB 8.3
- Mongoose ORM

**Collections:**

#### Users
```javascript
{
  _id: ObjectId,
  email: String,
  passwordHash: String,
  createdAt: Date,
  updatedAt: Date
}
```

#### Search Sessions
```javascript
{
  _id: ObjectId,
  userId: String (index),
  query: String,
  status: "running" | "complete" | "failed",
  conversationHistory: [
    { role: "user" | "assistant", content: String }
  ],
  foundJobs: [String],
  sitesSearched: [String],
  iterationCount: Number,
  startedAt: Date,
  completedAt: Date (optional),
  createdAt: Date
}
```

#### Jobs
```javascript
{
  _id: ObjectId,
  title: String,
  company: String,
  description: String,
  url: String (unique per source),
  salary: String (optional),
  location: String,
  sourceUrl: String,
  discoveredAt: Date,
  matchScore: Number (0-100),
  matchReasoning: String,
  searchSessionId: String (index),
  createdAt: Date
}
```

#### Sites
```javascript
{
  _id: ObjectId,
  domain: String (unique),
  jobBoardUrl: String,
  lastCrawled: Date (optional),
  discoveryMethod: "searxng_search" | "crawler_discovery" | "user_provided",
  createdAt: Date
}
```

---

## Event Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    User Initiates Search                      │
│                   (React Frontend)                            │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              API Creates Search Session                       │
│           POST /api/searches → SearchSessionModel             │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
            ┌────────────────────────────┐
            │   Emit search_started      │
            │   Event to BullMQ Queue    │
            └────────────┬───────────────┘
                         │
                         ▼
        ┌────────────────────────────────────┐
        │  Event Handler: Claude Analysis    │
        │  1. Fetch user's Claude API token  │
        │  2. Multi-round conversation       │
        │  3. Extract search parameters      │
        │  4. Emit claude_analysis_complete  │
        └────────────┬─────────────────────┘
                     │
                     ▼
        ┌────────────────────────────────────┐
        │  Event Handler: Job Crawler        │
        │  1. Call Scrapy crawler service    │
        │  2. Search for job boards          │
        │  3. Extract job listings           │
        │  4. Store in Jobs collection       │
        │  5. Emit jobs_crawled event        │
        └────────────┬─────────────────────┘
                     │
                     ▼
        ┌────────────────────────────────────┐
        │  Event Handler: Job Ranking        │
        │  1. Fetch extracted jobs           │
        │  2. Call Claude for evaluation     │
        │  3. Calculate match scores         │
        │  4. Update Jobs with scores        │
        │  5. Update search status complete  │
        │  6. Emit jobs_ranked event         │
        └────────────┬─────────────────────┘
                     │
                     ▼
        ┌────────────────────────────────────┐
        │  User Polls for Results            │
        │  GET /api/searches/{id}/jobs       │
        │  Returns ranked jobs               │
        └────────────────────────────────────┘
```

---

## Data Model Reference

### Search Session Lifecycle

```
CREATED (search_started event)
    ↓
RUNNING (processing in event handlers)
    ↓
COMPLETE (jobs_ranked event) or FAILED (error)
```

### Job Ranking Formula

Jobs are ranked based on:
- Keyword match in title/description
- Location compatibility
- Salary requirements
- Experience level alignment
- Additional factors provided by Claude AI

Each job receives:
- `matchScore` (0-100 scale)
- `matchReasoning` (explanation from Claude)

---

## Deployment Architecture

### Docker Services (docker-compose.yml)

```
┌──────────────────────────────────────────────┐
│           Container Network                   │
├──────────────────────────────────────────────┤
│                                               │
│  ┌────────────────┐   ┌──────────────────┐  │
│  │   MongoDB      │   │     Redis        │  │
│  │   Port 27017   │   │   Port 6379      │  │
│  └────────────────┘   └──────────────────┘  │
│          ▲                     ▲              │
│          │                     │              │
│  ┌───────┴────────────┬────────┴──────────┐  │
│  │                    │                    │  │
│  ▼                    ▼                    ▼  │
│┌──────────────┐  ┌──────────────┐  ┌────────┐
││   Express    │  │   Scrapy     │  │ React  │
││   API        │  │   Crawler    │  │ Dev    │
││ Port 3000   │  │ Port 8000    │  │Server  │
│└──────────────┘  └──────────────┘  └────────┘
│   Port 5173      │
└──────────────────┴────────────────────────────┘
```

### Environment Variables

**API Server:**
```
NODE_ENV=development
MONGODB_URI=mongodb://mongodb:27017/job_search
REDIS_URL=redis://redis:6379
JWT_SECRET=your-secret-key
PORT=3000
```

**Frontend:**
```
VITE_API_URL=http://localhost:3000
```

**Crawler:**
```
API_URL=http://api:3000
CRAWLER_PORT=8000
```

---

## Technology Versions

| Component | Technology | Version |
|-----------|-----------|---------|
| Frontend | React | 19.2.6 |
| Frontend | Vite | Latest |
| API Server | Express.js | 5.2.1 |
| Database | MongoDB | 8.3 |
| Cache/Queue | Redis | 8.6.3 |
| Runtime | Node.js | 20.x |
| Crawler | Scrapy | Latest |
| Crawler | Python | 3.9+ |
| AI | opencode agent | code.lehel.xyz |

---

## Future Enhancements

- WebSocket support for real-time search updates
- Advanced search filters and saved searches
- User preferences and notification settings
- Job board analytics and performance tracking
- Multi-language support
- Advanced caching strategies for frequently searched locations
- Machine learning model for improved job matching
