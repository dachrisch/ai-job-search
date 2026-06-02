# Job Search Platform - GEMINI.md

## Project Overview
This project is an AI-powered job search platform designed to discover, crawl, and rank job listings based on user queries. It uses a modular, event-driven architecture to coordinate between a web UI, an orchestration API, a Python-based web crawler, and Claude AI for intelligent analysis.

### Core Architecture
- **Event-Driven:** Uses BullMQ and Redis to manage asynchronous tasks (search refinement, crawling, ranking).
- **AI-Powered:** Integrates with Anthropic's Claude API to refine search parameters and rank job matches.
- **Real-Time Updates:** Employs Server-Sent Events (SSE) to stream progress from the backend to the frontend.
- **Monorepo Structure:** Managed via npm workspaces.

## Technology Stack
- **Frontend:** React 19, TypeScript, Vite, Vanilla CSS.
- **Backend (API):** Express.js 5, TypeScript, Node.js 20.
- **Database:** MongoDB 8.3 (Mongoose ORM).
- **Task Queue:** BullMQ with Redis 8.6.
- **Crawler:** Python 3.9+, Scrapy, BeautifulSoup.
- **AI:** Anthropic SDK (Claude).

## Project Structure
- `packages/api/`: Express.js backend, authentication, search orchestration, and event handlers.
- `packages/frontend/`: React web application for search input and results display.
- `packages/shared/`: Shared TypeScript type definitions (User, Job, SearchSession, etc.).
- `crawler/`: Python Scrapy project for job extraction.
- `docs/`: Technical documentation (Architecture, API, Crawler specs).

## Building and Running

### Prerequisites
- Node.js 20+
- MongoDB and Redis (Running on `10.185.182.250` for local dev environment or configurable via env vars).

### Initial Setup
```bash
# Install dependencies for all packages
npm install
```

### Development Commands
```bash
# Start both API (:3000) and Frontend (:5173) in parallel
npm run start:dev

# Build shared types (required before first run)
npm run build --workspace=@job-search/shared

# Run API tests
cd packages/api && npm test

# Run API tests with integration tests enabled
cd packages/api && RUN_INTEGRATION_TESTS=true npm test
```

### Environment Variables
Essential variables for the API:
- `MONGODB_URI`: Connection string for MongoDB.
- `REDIS_URL`: Connection string for Redis.
- `ANTHROPIC_API_KEY`: API key for Claude AI.

*Note: For reliability in the current environment, it is recommended to export these variables directly in the shell before running `npm run start:dev`.*

## Development Conventions
- **Type Safety:** All shared interfaces must be defined in `packages/shared/src/types.ts`.
- **Event Flow:** Long-running operations should be offloaded to BullMQ workers (`packages/api/src/events/handlers.ts`).
- **SSE Tracking:** Use the `SSEManager` utility in the API to push state updates to the frontend.
- **Testing:** Use Vitest for unit and integration tests. Mock external services (MongoDB, Redis) unless explicitly running integration tests.
- **Scaffolding:** Use `tsx` for running TypeScript scripts directly (e.g., seeding the database).
