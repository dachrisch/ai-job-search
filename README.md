# Job Search Platform

An intelligent job search platform powered by Claude AI that automatically discovers, extracts, and ranks job listings from across the web.

## Quick Start

### Prerequisites

- Node.js 20.x or higher
- npm 10.x or higher
- Docker and Docker Compose (for containerized setup)
- MongoDB 8.3+
- Redis 8.6.3+
- Python 3.9+ (for crawler)

### Development Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/yourusername/job-search.git
   cd job-search
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure environment variables:**
   ```bash
   cp .env.example .env
   # Edit .env and add your CLAUDE_API_KEY and database connection strings
   ```

4. **Start services with Docker:**
   ```bash
   docker-compose up -d
   ```

5. **Run development servers:**
   ```bash
   npm run dev
   ```

## Architecture

This is a monorepo containing three main packages:

- **api** - Express.js backend with MongoDB and event-driven architecture
- **frontend** - React 19.2.6 web application
- **shared** - TypeScript types and utilities used across packages
- **crawler** - Python-based Scrapy web crawler for job extraction

See [ARCHITECTURE.md](docs/ARCHITECTURE.md) for detailed system design.

## API Documentation

Complete API documentation is available in [API.md](docs/API.md), including:

- Authentication endpoints (register, login, set Claude token)
- Search creation and status endpoints
- Job listing endpoints
- Crawler integration
- Health check endpoints

## Project Structure

```
job-search/
├── packages/
│   ├── api/              # Express API server
│   │   ├── src/
│   │   │   ├── auth/     # JWT authentication
│   │   │   ├── routes/   # API endpoints
│   │   │   ├── db/       # MongoDB models
│   │   │   ├── claude/   # Claude AI client
│   │   │   └── events/   # BullMQ event handlers
│   │   └── tests/        # Integration tests
│   ├── frontend/         # React web application
│   │   ├── src/
│   │   │   ├── pages/    # Search and Results pages
│   │   │   ├── components/
│   │   │   └── hooks/    # useAuth, useSearch hooks
│   │   └── tests/
│   └── shared/           # TypeScript type definitions
├── crawler/              # Python Scrapy crawler
│   ├── job_crawler/      # Scrapy spiders
│   ├── cli.py            # CLI interface
│   └── server.py         # Flask HTTP endpoint
├── docs/                 # Documentation
│   ├── API.md           # API reference
│   └── ARCHITECTURE.md  # System architecture
└── docker-compose.yml    # Container orchestration
```

## Features (MVP)

- **User Authentication** - Registration and login with JWT tokens
- **AI-Powered Search** - Multi-round Claude AI conversations to refine job search queries
- **Web Crawling** - Scrapy-based crawler discovers job boards and extracts listings
- **Intelligent Ranking** - Claude AI evaluates and ranks jobs by match score
- **Real-time Status** - WebSocket and polling support for search progress
- **Job Persistence** - MongoDB stores users, jobs, and search sessions
- **Event-Driven Architecture** - BullMQ handles asynchronous job processing

## Development

### Run Tests

```bash
npm test --workspaces
```

### Build for Production

```bash
npm run build --workspaces
```

### Docker Setup

```bash
# Start all services
docker-compose up

# View logs
docker-compose logs -f api

# Stop services
docker-compose down
```

## Technologies

- **Frontend**: React 19.2.6, TypeScript, Vite
- **Backend API**: Express.js 5.2.1, TypeScript, Node.js 20.x
- **Database**: MongoDB 8.3 (Mongoose ORM)
- **Event Queue**: BullMQ with Redis 8.6.3
- **Web Crawler**: Scrapy, BeautifulSoup, Python 3.9+
- **AI Integration**: Anthropic Claude API
- **Authentication**: JWT (jsonwebtoken)
- **Testing**: Vitest, MongoDB Memory Server

## License

MIT
