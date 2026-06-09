# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 🔴 CRITICAL: Startup Requirements

**ALL development and testing MUST use servyy-test.lxd infrastructure:**
- **MongoDB:** `mongodb://10.185.182.250:27017/job_search`
- **Redis:** `redis://10.185.182.250:6379`
- **In-memory databases are NOT allowed** (no `USE_MEMORY_DB` option)

See **[.superpowers/startup/startup.md](.superpowers/startup/startup.md)** for complete startup checklist and troubleshooting.

## Quick Reference: Common Commands

### Development

```bash
# Start all services (API + Frontend with shared infrastructure)
npm run start:dev

# Start just the API server (uses external MongoDB/Redis on servyy-test.lxd)
npm run start:api

# Start just the frontend dev server
npm run start:frontend

# Build all packages for production
npm run build --workspaces

# Build specific package
npm run build --workspace=@job-search/api
npm run build --workspace=@job-search/frontend
```

### Testing & Quality

```bash
# Run all tests in the API package (62 tests)
cd packages/api && npm test -- --run

# Run tests with integration tests enabled
cd packages/api && RUN_INTEGRATION_TESTS=true npm test -- --run

# Run tests in watch mode (development)
cd packages/api && npm test

# TypeScript type checking
npm run build --workspace=@job-search/api
npm run build --workspace=@job-search/frontend
```

### CI/CD

```bash
# Simulate full CI pipeline (what GitHub Actions runs)
npm ci
npm run build --workspace=@job-search/shared
npm test -- --run --workspace=@job-search/api
npm run build --workspace=@job-search/api
npm run build --workspace=@job-search/frontend
```

---

## Architecture Overview

This is a **monorepo with 3 npm packages** following an **event-driven, AI-powered job discovery architecture**:

### High-Level Data Flow

1. **User initiates search** (React frontend) → 2. **API creates search session** → 3. **Event emitted to BullMQ queue** → 4. **Claude AI refines search parameters** → 5. **Web crawler discovers jobs** → 6. **Claude AI ranks jobs** → 7. **Results returned to frontend**

### Package Architecture

| Package | Purpose | Key Tech | Entry Points |
|---------|---------|----------|--------------|
| **api** | Express.js backend, auth, search orchestration, event handlers | Express, MongoDB, BullMQ, Anthropic SDK | `src/index.ts` starts server on port 3000 |
| **frontend** | React 19 web UI for search and results | React, TypeScript, Vite | `src/main.tsx` renders to `#app` |
| **shared** | TypeScript type definitions used across api/frontend | TypeScript only | `src/types.ts` exports all types |

### Event-Driven Architecture (BullMQ + Redis)

The system uses asynchronous event processing to decouple frontend requests from long-running operations:

- `search_started` → Triggered when user creates new search
- `claude_analysis_complete` → AI has refined search parameters
- `jobs_crawled` → Crawler extracted job listings
- `jobs_ranked` → Claude ranked jobs by match score

Event handlers live in `packages/api/src/events/handlers.ts`. Search status is tracked in MongoDB's `SearchSession` collection.

### Key Models (MongoDB)

- **User** - Auth credentials, Claude API token
- **SearchSession** - Search queries, status, conversation history with Claude
- **Job** - Extracted jobs with match scores and reasoning
- **Site** - Discovered job boards for crawler optimization

---

## Important Development Notes

### Test Infrastructure

⚠️ **Critical**: Tests require MongoDB and Redis to be running on **servyy-test.lxd** (not localhost). This is configured in `packages/api/vitest.config.ts`.

- MongoDB: `mongodb://10.185.182.250:27017/job_search`
- Redis: `redis://10.185.182.250:6379`
- See `/home/cda/.claude/projects/-home-cda-dev-job-search/memory/test_container_setup.md` for details

Integration tests (`tests/integration.test.ts`) are skipped by default since they require a running API server. Enable with `RUN_INTEGRATION_TESTS=true`.

### API Server Dependencies

The API requires three external services (either Docker containers or remote):

1. **MongoDB** - Stores all data (users, searches, jobs)
2. **Redis** - Powers BullMQ event queue for background jobs
3. **Claude API** - Requires `CLAUDE_API_KEY` in environment

All three can be started with `docker-compose up -d` or are available on servyy-test.lxd.

### Frontend Environment

Frontend communicates with API via `VITE_API_URL` (defaults to `http://localhost:3000`). When developing locally, the dev server is on port 5173.

### Vitest Configuration

⚠️ **Important**: `packages/api/vitest.config.ts` disables worker thread isolation (`isolate: false`) to avoid axios serialization errors in tests. This is intentional and required.

---

## Package Dependencies

- **All packages**: TypeScript 5.3.3, Node.js 20.x
- **api**: Express 5.2, Mongoose 8.0, BullMQ 5.77, Anthropic SDK 0.28, Vitest
- **frontend**: React 19, Vite 8, Vitest, React Testing Library
- **Root**: npm-run-all for parallel script execution

---

## CI/CD Pipeline

GitHub Actions workflow (`.github/workflows/ci.yml`) runs on every push to master/main:

1. **test job**: Runs API tests, builds api + frontend packages
2. **lint job**: TypeScript checks for both packages
3. **ci-status job**: Aggregates results and reports success/failure

All jobs must pass for branch protection. No external services needed in CI (tests use in-memory databases where applicable, integration tests skipped).

---

## Architecture Deep Dives & Documentation

For detailed documentation, see:

- **FEATURES.md** - Complete feature status (implemented, mocked, outstanding), security & production readiness assessment
- **ARCHITECTURE.md** - System design, event flow diagrams, database schemas
- **README.md** - Features, tech stack, project structure
- **API.md** - REST API endpoint reference and examples

---

## Development Workflow Notes

1. **Shared type changes** - Must rebuild `packages/shared` before other packages see changes
2. **API changes** - Server auto-reloads with `npm run dev` (uses tsx watch)
3. **Frontend changes** - Vite dev server provides instant HMR
4. **Event handler changes** - Restart API server for changes to take effect
5. **Database schema changes** - Mongoose will auto-update collections, but verify migrations

---

## Known Limitations

- Integration tests require running API server (skipped in CI)
- Crawler service is separate Python component (not in Node.js monorepo)
- WebSocket support for real-time updates is planned but not yet implemented
- Frontend has basic polling; switch to WebSockets once backend supports
