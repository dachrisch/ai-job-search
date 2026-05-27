# AI-Powered Job Search App: Design Specification

**Date:** May 27, 2026  
**Status:** Draft (Awaiting Implementation)  
**Version:** 1.0

---

## 1. Executive Summary

Build a new web application that helps users find job opportunities from actual company websites (not job aggregators) using an AI-guided search and evaluation loop.

**Core Value Proposition:** Users describe their ideal job in natural language, and the system autonomously discovers relevant positions from company sites, then evaluates them against the user's profile using Claude AI.

**MVP Scope:** Core loop only—search, crawl, evaluate, and present ranked results. No user profile management or application tracking in v1.

---

## 2. System Architecture

### 2.1 High-Level Overview

Three independently deployable services:

- **React Frontend** (localhost:5173) — User interface for job searches and results
- **Express API** (localhost:3000) — Core orchestration, Claude conversation management, state management
- **Python Crawler** (background worker) — Web scraping via Scrapy

**Supporting Infrastructure:**

- **Event Bus** (Redis + BullMQ) — Asynchronous orchestration of the agentic loop
- **Database** (MongoDB) — Persistent storage for users, jobs, sites, and search sessions
- **External APIs:**
  - Claude API — Search guidance, job evaluation, ranking
  - SearXNG API — Free, privacy-respecting web search

### 2.2 Architecture Diagram

```
┌─────────────────┐
│  React Frontend │ (user input, progress tracking, results)
└────────┬────────┘
         │
    ┌────▼────────────────────────────┐
    │     Express API (Port 3000)      │
    │  ├─ User Auth & Sessions         │
    │  ├─ Search Orchestration         │
    │  ├─ Claude Conversation Manager  │
    │  └─ Event Loop Handler           │
    └─┬──┬──────────────┬──────────────┘
      │  │              │
      │  │         ┌────▼──────────┐
      │  │         │  MongoDB      │ (jobs, users, sessions)
      │  │         └───────────────┘
      │  │
      │  └────────┬────────────────┐
      │           │                │
      │      ┌────▼────┐      ┌────▼─────────┐
      │      │  Redis  │      │  BullMQ      │ (event queue)
      │      │ (cache) │      └──────────────┘
      │      └─────────┘
      │
      ├─────────────────────────────┐
      │                             │
  ┌───▼──────┐            ┌────────▼──────┐
  │ SearXNG  │            │ Python Crawler │
  │ (search) │            │    (Scrapy)    │
  └──────────┘            └────────────────┘
```

---

## 3. Components & Responsibilities

### 3.1 Express API

**Responsibilities:**
- User authentication (register, login) with JWT tokens
- Accept job search queries via `POST /api/searches`
- Store and retrieve Claude API tokens (encrypted in database)
- Orchestrate the agentic loop by listening to and emitting events
- Maintain Claude conversation history for multi-turn interactions
- Store search session state (which sites were tried, iteration count, etc.)
- Provide results API for frontend to fetch ranked jobs

**Technology:** Express.js 5.2.1, Node.js 24 LTS, TypeScript

### 3.2 React Frontend

**Responsibilities:**
- Job search input form (natural language prompt)
- Real-time progress display during search
- Results page showing ranked job matches with match scores
- Simple user account management (register, login, set Claude API token)

**Technology:** React 19.2.6, Vite 8.0.14, TypeScript, Axios

### 3.3 Python Crawler

**Responsibilities:**
- Receive URLs from Express API
- Extract job posting data (title, company, description, salary, location, etc.)
- Report success/failure back to Express
- Discover new job sites during crawling (report back to system)

**Technology:** Python 3.14, Scrapy 2.16.0

### 3.4 Event Bus (Redis + BullMQ)

**Responsibilities:**
- Queue and deliver events to event handlers
- Provide durability (events persisted until processed)
- Allow Express to subscribe to event types

**Technology:** Redis 8.6.3, BullMQ 5.77.3

**Events in the System:**
- `search_started` — User initiates a job search
- `sites_identified` — Claude suggests sites to crawl
- `crawl_requested` — System queues crawler task
- `jobs_scraped` — Crawler reports jobs found
- `analysis_complete` — Claude finishes analysis
- `search_refined` — Claude requests more searches
- `search_complete` — Claude decides to stop and rank results

---

## 4. Data Model

### 4.1 Users Collection

```javascript
{
  _id: ObjectId,
  email: string (unique),
  passwordHash: string,
  claudeApiToken: string (encrypted),
  createdAt: Date,
  updatedAt: Date
}
```

### 4.2 Jobs Collection

```javascript
{
  _id: ObjectId,
  title: string,
  company: string,
  description: string,
  url: string,
  salary: string | null,
  location: string,
  sourceUrl: string (domain it was found on),
  discoveredAt: Date,
  matchScore: number | null (0-100, from Claude),
  matchReasoning: string | null (why Claude thinks it's a good match),
  searchSessionId: ObjectId (foreign key to SearchSession)
}
```

### 4.3 Sites Collection

```javascript
{
  _id: ObjectId,
  domain: string (e.g., "company.com"),
  jobBoardUrl: string,
  lastCrawled: Date | null,
  discoveryMethod: string ("searxng_search" | "crawler_discovery" | "user_provided"),
  createdAt: Date
}
```

### 4.4 Search Sessions Collection

```javascript
{
  _id: ObjectId,
  userId: ObjectId (foreign key to Users),
  query: string (user's job search prompt),
  status: "running" | "complete" | "failed",
  claudeConversationHistory: [
    { role: "user", content: string },
    { role: "assistant", content: string }
  ],
  foundJobs: [ObjectId] (array of job IDs),
  sitesSearched: [ObjectId] (array of site IDs tried),
  iterationCount: number,
  startedAt: Date,
  completedAt: Date | null,
  createdAt: Date
}
```

---

## 5. Key Workflows

### 5.1 User Initiates Search

1. User navigates to search page, enters prompt: *"I want a remote Python backend job in Berlin"*
2. Frontend calls `POST /api/searches` with query and user ID
3. Express creates Search Session record, marks status as `"running"`
4. Express emits `search_started` event
5. Frontend polls `GET /api/searches/:id` for progress or uses WebSocket for real-time updates

### 5.2 Claude Analyzes & Suggests Sites

1. `search_started` event handler in Express triggers
2. Express calls Claude API with context:
   - User's search prompt
   - Sites already tried (from session history)
   - Any jobs found so far
   - Prompt: *"Given this job search, what 3-5 sites should we search? Return JSON with site names and keywords."*
3. Claude responds: *`{sites: ["company1.com", "company2.com"], keywords: "Python Berlin Remote"}`*
4. Express stores response in conversation history
5. Express emits `sites_identified` event with Claude's suggestions

### 5.3 Crawler Executes

1. `sites_identified` event handler triggers
2. Express calls Python crawler via HTTP endpoint `POST /crawler/scrape`
   - Payload: `{urls: ["https://company1.com/jobs", ...], keywords: "Python Berlin Remote"}`
3. Crawler scrapes each URL for job postings using Scrapy
4. Crawler extracts: title, company, description, salary, location, URL
5. Crawler reports back: `{found: 5, jobs: [...], newSites: ["company3.com"]}`
6. Express stores jobs in Jobs collection
7. Express stores new discovered sites in Sites collection
8. Express emits `jobs_scraped` event with results

### 5.4 Claude Decides: Continue or Complete?

1. `jobs_scraped` event handler triggers
2. Express sends to Claude:
   - *"We found X jobs so far. Here's what we've tried. Should we search more sites, or do we have enough?"*
   - Include summary of jobs found (titles, companies)
3. Claude either:
   - **Option A:** *"Try these additional sites for better coverage..."* → Emit `search_refined` event → loop back to 5.2
   - **Option B:** *"We have good coverage. Rank these jobs by match to the user's profile."* → Emit `search_complete` event → proceed to 5.5

### 5.5 Claude Ranks & Evaluates

1. `search_complete` event handler triggers
2. Express sends all found jobs to Claude with prompt:
   - *"Rank these jobs by how well they match the user's stated goal. Provide a match score 0-100 and brief reasoning for each."*
3. Claude reviews all jobs and returns:
   ```json
   [
     {jobId: "...", matchScore: 95, reasoning: "Perfect fit: remote, Python, Berlin-based"},
     {jobId: "...", matchScore: 78, reasoning: "Remote + Python but not Berlin"}
   ]
   ```
4. Express updates each job with matchScore and matchReasoning
5. Express marks Search Session as `status: "complete"`
6. Frontend fetches results from `GET /api/searches/:id/jobs` sorted by matchScore descending

### 5.6 Frontend Displays Results

1. Frontend shows ranked list of jobs
2. User can click each job to see:
   - Title, company, description
   - Claude's match score and reasoning
   - Link to original posting

---

## 6. API Endpoints

### 6.1 Authentication

```
POST /api/auth/register
  Request: { email, password }
  Response: { userId, token }

POST /api/auth/login
  Request: { email, password }
  Response: { userId, token }

POST /api/auth/set-claude-token
  Headers: { Authorization: "Bearer <token>" }
  Request: { claudeApiToken }
  Response: { success: true }
```

### 6.2 Search

```
POST /api/searches
  Headers: { Authorization: "Bearer <token>" }
  Request: { query: "I want a remote Python backend job in Berlin" }
  Response: { searchId, status: "running" }

GET /api/searches/:id
  Headers: { Authorization: "Bearer <token>" }
  Response: {
    searchId,
    status: "running" | "complete" | "failed",
    iterationCount,
    jobsFoundCount,
    startedAt,
    completedAt
  }

GET /api/searches/:id/jobs
  Headers: { Authorization: "Bearer <token>" }
  Response: [
    {
      id,
      title,
      company,
      description,
      url,
      salary,
      location,
      matchScore,
      matchReasoning
    }
  ]
```

### 6.3 Crawler (Internal)

```
POST /crawler/scrape
  Request: { urls: [...], keywords: "..." }
  Response: { found: number, jobs: [...], newSites: [...] }
```

### 6.4 Health

```
GET /api/health
  Response: { status: "ok" }
```

---

## 7. Event Flow Diagram

```
User initiates search
    ↓
    emit: search_started
    ↓
    [Express] calls Claude: "Suggest sites to search"
    ↓
    emit: sites_identified (with site list)
    ↓
    [Express] calls Crawler: "Scrape these sites"
    ↓
    emit: jobs_scraped (with job list)
    ↓
    [Express] asks Claude: "Continue or complete?"
    ↓
    ┌─────────────────────────────────────┐
    │ Does Claude want more searches?     │
    └─────────────────────────────────────┘
    ├─ YES → emit: search_refined
    │         (go back to Claude: "Suggest more sites")
    │
    └─ NO → emit: search_complete
            [Express] calls Claude: "Rank all jobs"
            ↓
            emit: ranking_complete
            ↓
            Update all jobs with matchScore
            ↓
            Results available to frontend
```

---

## 8. Tech Stack

| Component | Technology | Version | Rationale |
|-----------|-----------|---------|-----------|
| **Frontend** | React | 19.2.6 | Latest stable, Server Components support |
| | Vite | 8.0.14 | Rolldown bundler, 10-30x faster builds |
| | TypeScript | Latest | Type safety |
| **Backend** | Express.js | 5.2.1 | Lightweight, proven, good ecosystem |
| | Node.js | 24 LTS | Current Active LTS, production-ready |
| | TypeScript | Latest | Type safety |
| **Crawler** | Python | 3.14 | Latest stable |
| | Scrapy | 2.16.0 | Industry standard for web scraping, native async/await |
| **Queue** | BullMQ | 5.77.3 | Modern replacement for Bull, actively maintained |
| | Redis | 8.6.3 | Message queue backing, caching |
| **Database** | MongoDB | 8.3 | Flexible schema, good for evolving data model |
| | Mongoose | Latest | ODM for MongoDB |
| **AI** | Claude API | 3.5 Sonnet | Best-in-class reasoning for job analysis |
| **Search** | SearXNG | Current | Privacy-respecting, free web search |

---

## 9. Development Approach

### 9.1 Monorepo Structure

```
job-search/
├── packages/
│   ├── api/                    # Express backend
│   │   ├── src/
│   │   │   ├── auth/
│   │   │   ├── searches/
│   │   │   ├── events/
│   │   │   ├── db/
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── frontend/               # React app
│   │   ├── src/
│   │   │   ├── pages/
│   │   │   ├── components/
│   │   │   ├── hooks/
│   │   │   └── App.tsx
│   │   ├── package.json
│   │   └── vite.config.ts
│   │
│   └── shared/                 # Shared types
│       ├── types.ts
│       └── package.json
│
├── crawler/                    # Python Scrapy project
│   ├── job_crawler/
│   │   ├── spiders/
│   │   └── items.py
│   ├── requirements.txt
│   └── cli.py
│
├── docker-compose.yml          # Local dev environment
├── .env.example
└── README.md
```

### 9.2 Local Development Setup

**Prerequisites:**
- Node.js 24 LTS
- Python 3.14
- Docker + Docker Compose

**Startup:**
```bash
# Start infrastructure (MongoDB, Redis)
docker-compose up

# Terminal 1: Backend API
cd packages/api
npm install
npm run dev

# Terminal 2: Frontend
cd packages/frontend
npm install
npm run dev

# Terminal 3: Python Crawler (as a subprocess called by Express during searches)
cd crawler
pip install -r requirements.txt
python cli.py  # or run as subprocess from Express
```

**Frontend:** http://localhost:5173  
**Backend:** http://localhost:3000  
**MongoDB:** localhost:27017  
**Redis:** localhost:6379

### 9.3 Deployment

**Development:** Local Docker Compose  
**Production:** (TBD after MVP) — likely Docker containers on cloud (AWS/GCP/etc.)

---

## 10. Success Criteria

**MVP is complete when:**

1. ✅ User can register/login with email and password
2. ✅ User can set Claude API token via UI
3. ✅ User can enter a job search prompt
4. ✅ System performs agentic search loop (Claude directs, crawler executes)
5. ✅ Claude makes intelligent decisions about when to stop searching
6. ✅ All found jobs are ranked by match score
7. ✅ Frontend displays ranked results with match reasoning
8. ✅ Search loop completes in under 5 minutes for typical queries
9. ✅ No duplicate jobs in results
10. ✅ Basic error handling (failed scrapes, API errors don't crash system)

---

## 11. Future Enhancements (Post-MVP)

- User profile management (skills, experience level, salary expectations)
- Application tracking (save favorite jobs, track application status)
- Site management UI (add custom job sites, manage sources)
- Email notifications (new matching jobs found)
- Advanced filtering and saved searches
- Analytics on search patterns and job trends

---

## 12. Open Questions & Decisions

1. **Crawler as subprocess vs. separate service?** Currently assuming subprocess called by Express. Could be spun out to separate worker service later.
2. **WebSocket vs. polling for progress?** MVP uses polling (simpler). WebSocket for better UX in v1.1.
3. **Job duplication handling?** Need deduplication logic (same title/company/URL = duplicate).
4. **Rate limiting on SearXNG?** Need to test if SearXNG has rate limits and handle gracefully.
5. **Claude token cost?** Need cost estimation for typical searches (multiple API calls per search).

---

**Design Document Status:** ✅ Complete and ready for implementation planning.
