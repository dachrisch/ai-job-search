# Job Search Platform - Architecture Documentation

## System Overview

The Job Search Platform is a modular, event-driven system that enables intelligent job discovery through AI-powered search and web crawling. Here's how the job discovery process works:

### 5-Step Job Discovery Process

1. **User Initiates Search** - User submits job search query through the React frontend
2. **Search Session Created** - API creates a new search session and emits `search_started` event to the event queue
3. **Claude AI Analysis** - AI service processes the query through multi-round Claude conversations to refine search parameters
4. **Web Crawling** - Crawler discovers relevant job boards and extracts job listings matching the refined parameters
5. **Job Ranking & Storage** - Extracted jobs are evaluated by Claude, ranked by match score, and stored in MongoDB

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
- `POST /api/auth/set-claude-token` - Store Claude API key
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
- `claude_analysis_complete` - AI has refined search parameters
- `jobs_crawled` - Crawler has extracted job listings
- `jobs_ranked` - Claude has ranked jobs by match

**Key Files:**
- `src/events/queue.ts` - Queue configuration and event publishing
- `src/events/handlers.ts` - Event handler implementations

---

### Claude AI Client

**Technology Stack:**
- Anthropic Claude API (Claude 3.5 Sonnet)
- TypeScript SDK
- Conversation history management

**Responsibilities:**
- Multi-round conversational search refinement
- Query parameter extraction
- Job evaluation and ranking
- Match score calculation with reasoning

**Key Files:**
- `src/claude/client.ts` - API client and conversation logic

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
  claudeApiToken: String (optional),
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
  claudeConversationHistory: [
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
| AI | Claude API | 3.5 Sonnet |

---

## Future Enhancements

- WebSocket support for real-time search updates
- Advanced search filters and saved searches
- User preferences and notification settings
- Job board analytics and performance tracking
- Multi-language support
- Advanced caching strategies for frequently searched locations
- Machine learning model for improved job matching
