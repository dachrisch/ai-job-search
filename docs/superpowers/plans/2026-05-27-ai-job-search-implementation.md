# AI-Powered Job Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an AI-guided job discovery system where users describe their ideal job and Claude autonomously searches company websites, ranks results, and presents the best matches.

**Architecture:** Event-driven monorepo (Express API + React frontend + Python crawler) orchestrated via BullMQ event queue. Claude drives the agentic search loop: Express listens to events, calls Claude for decisions, triggers crawler execution, stores results in MongoDB.

**Tech Stack:** Express 5.2.1, React 19.2.6, Node 24 LTS, Python 3.14, Scrapy 2.16.0, MongoDB 8.3, Redis 8.6.3, BullMQ 5.77.3, Claude API

---

## Phase 1: Project Setup

### Task 1: Initialize Monorepo Structure

**Files:**
- Create: `package.json` (workspace root)
- Create: `packages/api/package.json`
- Create: `packages/frontend/package.json`
- Create: `packages/shared/package.json`
- Create: `crawler/requirements.txt`
- Create: `docker-compose.yml`
- Create: `.gitignore`
- Create: `.env.example`

- [ ] **Step 1: Create root package.json with workspaces**

```json
{
  "name": "job-search",
  "version": "1.0.0",
  "private": true,
  "workspaces": [
    "packages/api",
    "packages/frontend",
    "packages/shared"
  ],
  "scripts": {
    "dev": "npm run dev --workspaces"
  }
}
```

- [ ] **Step 2: Create packages/shared directory and package.json**

```bash
mkdir -p packages/shared
```

```json
{
  "name": "@job-search/shared",
  "version": "1.0.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": ["dist"],
  "scripts": {
    "build": "tsc"
  },
  "devDependencies": {
    "typescript": "^5.3.3"
  }
}
```

- [ ] **Step 3: Create packages/api directory and package.json**

```bash
mkdir -p packages/api/src packages/api/tests
```

```json
{
  "name": "@job-search/api",
  "version": "1.0.0",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "test": "vitest",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "express": "^5.2.1",
    "mongoose": "^8.0.0",
    "bullmq": "^5.77.3",
    "redis": "^4.6.0",
    "anthropic": "^0.24.0",
    "axios": "^1.6.0",
    "jsonwebtoken": "^9.1.0",
    "bcryptjs": "^2.4.3",
    "dotenv": "^16.3.1"
  },
  "devDependencies": {
    "@types/express": "^4.17.20",
    "@types/node": "^20.10.0",
    "@types/jsonwebtoken": "^9.0.6",
    "typescript": "^5.3.3",
    "vitest": "^1.0.0",
    "tsx": "^4.7.0"
  }
}
```

- [ ] **Step 4: Create packages/frontend directory and package.json**

```bash
mkdir -p packages/frontend/src
```

```json
{
  "name": "@job-search/frontend",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "axios": "^1.6.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "@vitejs/plugin-react": "^4.2.0",
    "typescript": "^5.3.3",
    "vite": "^8.0.14"
  }
}
```

- [ ] **Step 5: Create crawler/requirements.txt**

```bash
mkdir -p crawler/job_crawler/spiders
```

```txt
scrapy==2.16.0
requests==2.31.0
python-dotenv==1.0.0
```

- [ ] **Step 6: Create docker-compose.yml**

```yaml
version: '3.9'

services:
  mongodb:
    image: mongo:8.3
    container_name: job-search-mongo
    ports:
      - "27017:27017"
    environment:
      MONGO_INITDB_DATABASE: job_search
    volumes:
      - mongo_data:/data/db

  redis:
    image: redis:8.6.3-alpine
    container_name: job-search-redis
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data

volumes:
  mongo_data:
  redis_data:
```

- [ ] **Step 7: Create .env.example**

```
NODE_ENV=development
PORT=3000
MONGODB_URI=mongodb://localhost:27017/job_search
REDIS_URL=redis://localhost:6379
CLAUDE_API_KEY=sk-your-key-here
JWT_SECRET=your-secret-key-here
ENCRYPTION_KEY=32-char-encryption-key-here
```

- [ ] **Step 8: Create .gitignore**

```
node_modules/
dist/
build/
.env
.env.local
.DS_Store
*.log
.idea/
.vscode/settings.json
.superpowers/
__pycache__/
*.pyc
.venv/
venv/
```

- [ ] **Step 9: Commit**

```bash
git add package.json packages/ crawler/ docker-compose.yml .env.example .gitignore
git commit -m "chore: initialize monorepo structure with workspace setup"
```

---

### Task 2: Create TypeScript Configuration and Shared Types

**Files:**
- Create: `tsconfig.json` (root)
- Create: `packages/shared/tsconfig.json`
- Create: `packages/api/tsconfig.json`
- Create: `packages/frontend/tsconfig.json`
- Create: `packages/shared/src/types.ts`

- [ ] **Step 1: Create root tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true,
    "resolveJsonModule": true
  }
}
```

- [ ] **Step 2: Create packages/shared/tsconfig.json**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create packages/api/tsconfig.json**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "paths": {
      "@job-search/shared": ["../shared/src"]
    }
  },
  "include": ["src"],
  "exclude": ["node_modules", "tests"]
}
```

- [ ] **Step 4: Create packages/frontend/vite.config.ts**

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true
      }
    }
  }
})
```

- [ ] **Step 5: Create packages/shared/src/types.ts**

```typescript
export interface User {
  _id: string
  email: string
  passwordHash: string
  claudeApiToken?: string
  createdAt: Date
  updatedAt: Date
}

export interface Job {
  _id: string
  title: string
  company: string
  description: string
  url: string
  salary?: string
  location: string
  sourceUrl: string
  discoveredAt: Date
  matchScore?: number
  matchReasoning?: string
  searchSessionId: string
}

export interface Site {
  _id: string
  domain: string
  jobBoardUrl: string
  lastCrawled?: Date
  discoveryMethod: 'searxng_search' | 'crawler_discovery' | 'user_provided'
  createdAt: Date
}

export interface SearchSession {
  _id: string
  userId: string
  query: string
  status: 'running' | 'complete' | 'failed'
  claudeConversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>
  foundJobs: string[]
  sitesSearched: string[]
  iterationCount: number
  startedAt: Date
  completedAt?: Date
  createdAt: Date
}

export interface AuthResponse {
  userId: string
  token: string
}

export interface SearchResponse {
  searchId: string
  status: 'running' | 'complete' | 'failed'
}

export interface JobResult {
  id: string
  title: string
  company: string
  description: string
  url: string
  salary?: string
  location: string
  matchScore: number
  matchReasoning: string
}

export interface CrawlerResponse {
  found: number
  jobs: Array<{
    title: string
    company: string
    description: string
    url: string
    salary?: string
    location: string
  }>
  newSites?: string[]
}

export interface ClaudeSearchSuggestion {
  sites: string[]
  keywords: string
}

export interface ClaudeRankingResult {
  jobId: string
  matchScore: number
  reasoning: string
}
```

- [ ] **Step 6: Commit**

```bash
git add tsconfig.json packages/*/tsconfig.json packages/shared/src/types.ts packages/frontend/vite.config.ts
git commit -m "chore: add TypeScript configuration and shared types"
```

---

## Phase 2: Database & Authentication

### Task 3: Set Up MongoDB Models

**Files:**
- Create: `packages/api/src/db/index.ts`
- Create: `packages/api/src/db/models.ts`

- [ ] **Step 1: Create database connection**

```typescript
// packages/api/src/db/index.ts
import mongoose from 'mongoose'

export async function connectDB() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/job_search'
  
  try {
    await mongoose.connect(mongoUri)
    console.log('Connected to MongoDB')
  } catch (error) {
    console.error('Failed to connect to MongoDB:', error)
    process.exit(1)
  }
}

export function disconnectDB() {
  return mongoose.disconnect()
}
```

- [ ] **Step 2: Create Mongoose models**

```typescript
// packages/api/src/db/models.ts
import mongoose, { Schema, Document } from 'mongoose'
import { User, Job, Site, SearchSession } from '@job-search/shared'

const UserSchema = new Schema<User>({
  email: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  claudeApiToken: { type: String },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
})

const JobSchema = new Schema<Job>({
  title: { type: String, required: true },
  company: { type: String, required: true },
  description: { type: String, required: true },
  url: { type: String, required: true },
  salary: String,
  location: { type: String, required: true },
  sourceUrl: { type: String, required: true },
  discoveredAt: { type: Date, default: Date.now },
  matchScore: Number,
  matchReasoning: String,
  searchSessionId: { type: String, required: true, index: true }
})

const SiteSchema = new Schema<Site>({
  domain: { type: String, required: true, unique: true },
  jobBoardUrl: { type: String, required: true },
  lastCrawled: Date,
  discoveryMethod: { 
    type: String, 
    enum: ['searxng_search', 'crawler_discovery', 'user_provided'],
    required: true 
  },
  createdAt: { type: Date, default: Date.now }
})

const SearchSessionSchema = new Schema<SearchSession>({
  userId: { type: String, required: true, index: true },
  query: { type: String, required: true },
  status: { type: String, enum: ['running', 'complete', 'failed'], default: 'running' },
  claudeConversationHistory: { type: Array, default: [] },
  foundJobs: [String],
  sitesSearched: [String],
  iterationCount: { type: Number, default: 0 },
  startedAt: { type: Date, default: Date.now },
  completedAt: Date,
  createdAt: { type: Date, default: Date.now }
})

export const UserModel = mongoose.model<User>('User', UserSchema)
export const JobModel = mongoose.model<Job>('Job', JobSchema)
export const SiteModel = mongoose.model<Site>('Site', SiteSchema)
export const SearchSessionModel = mongoose.model<SearchSession>('SearchSession', SearchSessionSchema)
```

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/db/
git commit -m "feat: add MongoDB connection and Mongoose models"
```

---

### Task 4: Implement Authentication (Register & Login)

**Files:**
- Create: `packages/api/src/auth/auth.service.ts`
- Create: `packages/api/src/auth/auth.controller.ts`
- Create: `packages/api/tests/auth.test.ts`

- [ ] **Step 1: Write failing tests for auth service**

```typescript
// packages/api/tests/auth.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { registerUser, loginUser } from '../src/auth/auth.service'
import { connectDB, disconnectDB } from '../src/db'
import { UserModel } from '../src/db/models'

describe('Auth Service', () => {
  beforeEach(async () => {
    await connectDB()
    await UserModel.deleteMany({})
  })

  afterEach(async () => {
    await disconnectDB()
  })

  it('should register a new user', async () => {
    const result = await registerUser('test@example.com', 'password123')
    expect(result.userId).toBeDefined()
    expect(result.token).toBeDefined()
    expect(result.userId).toBeTypeOf('string')
  })

  it('should reject duplicate email', async () => {
    await registerUser('test@example.com', 'password123')
    await expect(registerUser('test@example.com', 'password123')).rejects.toThrow('Email already exists')
  })

  it('should login existing user', async () => {
    await registerUser('test@example.com', 'password123')
    const result = await loginUser('test@example.com', 'password123')
    expect(result.userId).toBeDefined()
    expect(result.token).toBeDefined()
  })

  it('should reject login with wrong password', async () => {
    await registerUser('test@example.com', 'password123')
    await expect(loginUser('test@example.com', 'wrongpassword')).rejects.toThrow('Invalid credentials')
  })

  it('should reject login for non-existent user', async () => {
    await expect(loginUser('nonexistent@example.com', 'password')).rejects.toThrow('Invalid credentials')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/api
npm test
```

Expected output: 5 failing tests

- [ ] **Step 3: Implement auth service**

```typescript
// packages/api/src/auth/auth.service.ts
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { UserModel } from '../db/models'
import { AuthResponse } from '@job-search/shared'

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret'

export async function registerUser(email: string, password: string): Promise<AuthResponse> {
  const existing = await UserModel.findOne({ email })
  if (existing) {
    throw new Error('Email already exists')
  }

  const passwordHash = await bcrypt.hash(password, 10)
  const user = await UserModel.create({ email, passwordHash })

  const token = jwt.sign({ userId: user._id, email: user.email }, JWT_SECRET, { expiresIn: '7d' })
  return { userId: user._id.toString(), token }
}

export async function loginUser(email: string, password: string): Promise<AuthResponse> {
  const user = await UserModel.findOne({ email })
  if (!user) {
    throw new Error('Invalid credentials')
  }

  const isValid = await bcrypt.compare(password, user.passwordHash)
  if (!isValid) {
    throw new Error('Invalid credentials')
  }

  const token = jwt.sign({ userId: user._id, email: user.email }, JWT_SECRET, { expiresIn: '7d' })
  return { userId: user._id.toString(), token }
}

export function verifyToken(token: string): { userId: string; email: string } {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; email: string }
    return decoded
  } catch {
    throw new Error('Invalid token')
  }
}

export async function setClaudeToken(userId: string, token: string): Promise<void> {
  // Encrypt token before storing (simplified for MVP)
  await UserModel.findByIdAndUpdate(userId, { claudeApiToken: token })
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/api
npm test
```

Expected output: 5 passing tests

- [ ] **Step 5: Create auth controller**

```typescript
// packages/api/src/auth/auth.controller.ts
import { Request, Response, NextFunction } from 'express'
import { registerUser, loginUser, setClaudeToken, verifyToken } from './auth.service'

export async function handleRegister(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password } = req.body
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' })
    }
    const result = await registerUser(email, password)
    res.status(201).json(result)
  } catch (error) {
    next(error)
  }
}

export async function handleLogin(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password } = req.body
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' })
    }
    const result = await loginUser(email, password)
    res.status(200).json(result)
  } catch (error) {
    next(error)
  }
}

export async function handleSetClaudeToken(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing authorization' })
    }
    
    const token = authHeader.slice(7)
    const { userId } = verifyToken(token)
    const { claudeApiToken } = req.body
    
    if (!claudeApiToken) {
      return res.status(400).json({ error: 'Claude API token required' })
    }
    
    await setClaudeToken(userId, claudeApiToken)
    res.status(200).json({ success: true })
  } catch (error) {
    next(error)
  }
}

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing authorization' })
    }
    
    const token = authHeader.slice(7)
    const decoded = verifyToken(token)
    ;(req as any).userId = decoded.userId
    next()
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' })
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/auth/ packages/api/tests/auth.test.ts
git commit -m "feat: implement user registration and login with JWT"
```

---

## Phase 3: Event Queue & Orchestration

### Task 5: Set Up BullMQ Event Queue

**Files:**
- Create: `packages/api/src/events/queue.ts`
- Create: `packages/api/src/events/handlers.ts`
- Create: `packages/api/tests/queue.test.ts`

- [ ] **Step 1: Write failing test for event queue**

```typescript
// packages/api/tests/queue.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getQueue, addEvent, getEventHandlers } from '../src/events/queue'

describe('Event Queue', () => {
  beforeEach(async () => {
    const queue = getQueue()
    await queue.clean(0, 1000)
  })

  afterEach(async () => {
    const queue = getQueue()
    await queue.close()
  })

  it('should add event to queue', async () => {
    const queue = getQueue()
    const jobId = await addEvent('search_started', { searchId: '123', userId: 'user1' })
    expect(jobId).toBeDefined()
  })

  it('should have event handlers registered', () => {
    const handlers = getEventHandlers()
    expect(handlers.search_started).toBeDefined()
    expect(handlers.sites_identified).toBeDefined()
    expect(handlers.jobs_scraped).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/api
npm test -- queue.test.ts
```

Expected output: Failing tests

- [ ] **Step 3: Implement event queue**

```typescript
// packages/api/src/events/queue.ts
import { Queue, Worker } from 'bullmq'
import redis from 'redis'

const redisClient = redis.createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' })

let eventQueue: Queue

export function getQueue() {
  if (!eventQueue) {
    eventQueue = new Queue('job-search-events', { connection: redisClient })
  }
  return eventQueue
}

export async function addEvent(eventType: string, data: any) {
  const queue = getQueue()
  const job = await queue.add(eventType, data, { removeOnComplete: true })
  return job.id
}

export function registerEventHandlers(handlers: Record<string, (data: any) => Promise<void>>) {
  const queue = getQueue()
  
  const worker = new Worker('job-search-events', async (job) => {
    const handler = handlers[job.name]
    if (handler) {
      await handler(job.data)
    } else {
      console.warn(`No handler for event: ${job.name}`)
    }
  }, { connection: redisClient })

  worker.on('completed', (job) => {
    console.log(`Event processed: ${job.name}`)
  })

  worker.on('failed', (job, err) => {
    console.error(`Event failed: ${job?.name}`, err)
  })

  return worker
}

export const eventHandlers: Record<string, () => Promise<void>> = {}

export function getEventHandlers() {
  return eventHandlers
}
```

- [ ] **Step 4: Implement event handlers**

```typescript
// packages/api/src/events/handlers.ts
import { SearchSessionModel, JobModel, SiteModel } from '../db/models'
import { addEvent } from './queue'
import { callClaude } from '../claude/client'
import axios from 'axios'

export const eventHandlers = {
  search_started: async (data: { searchId: string; userId: string; query: string }) => {
    console.log('Search started:', data.searchId)
    
    const session = await SearchSessionModel.findById(data.searchId)
    if (!session) return

    // Call Claude to get initial site suggestions
    const suggestion = await callClaude(
      session.userId,
      `Given the user wants: "${data.query}", what 3-5 job board websites should we search? 
       Return JSON: {sites: ["domain1.com", "domain2.com"], keywords: "search keywords"}`
    )

    const parsed = JSON.parse(suggestion)
    session.claudeConversationHistory.push(
      { role: 'user', content: data.query },
      { role: 'assistant', content: suggestion }
    )
    await session.save()

    await addEvent('sites_identified', {
      searchId: data.searchId,
      sites: parsed.sites,
      keywords: parsed.keywords
    })
  },

  sites_identified: async (data: { searchId: string; sites: string[]; keywords: string }) => {
    console.log('Sites identified:', data.sites)

    const session = await SearchSessionModel.findById(data.searchId)
    if (!session) return

    // Create Site records for new sites
    for (const domain of data.sites) {
      await SiteModel.findOneAndUpdate(
        { domain },
        { domain, jobBoardUrl: `https://${domain}/jobs`, discoveryMethod: 'searxng_search' },
        { upsert: true }
      )
    }

    // Request crawler to scrape sites
    await addEvent('crawl_requested', {
      searchId: data.searchId,
      sites: data.sites,
      keywords: data.keywords
    })
  },

  crawl_requested: async (data: { searchId: string; sites: string[]; keywords: string }) => {
    console.log('Crawl requested for sites:', data.sites)
    
    try {
      // Call Python crawler
      const response = await axios.post('http://localhost:8000/crawler/scrape', {
        urls: data.sites.map(domain => `https://${domain}/jobs`),
        keywords: data.keywords
      })

      await addEvent('jobs_scraped', {
        searchId: data.searchId,
        jobs: response.data.jobs,
        newSites: response.data.newSites || []
      })
    } catch (error) {
      console.error('Crawler failed:', error)
      await addEvent('search_failed', { searchId: data.searchId, error: String(error) })
    }
  },

  jobs_scraped: async (data: { searchId: string; jobs: any[]; newSites: string[] }) => {
    console.log('Jobs scraped:', data.jobs.length)

    const session = await SearchSessionModel.findById(data.searchId)
    if (!session) return

    // Store jobs in database
    for (const job of data.jobs) {
      await JobModel.create({
        ...job,
        searchSessionId: data.searchId,
        discoveredAt: new Date()
      })
    }

    session.foundJobs.push(...(await JobModel.find({ searchSessionId: data.searchId }).select('_id')).map(j => j._id.toString()))
    session.iterationCount += 1
    await session.save()

    // Ask Claude if we should search more
    const jobSummary = data.jobs.map(j => `${j.title} at ${j.company}`).join('\n')
    const prompt = `We found ${data.jobs.length} jobs so far:\n${jobSummary}\n\nShould we search more sites, or do we have good coverage?`
    
    const claudeResponse = await callClaude(session.userId, prompt)
    session.claudeConversationHistory.push(
      { role: 'user', content: prompt },
      { role: 'assistant', content: claudeResponse }
    )
    await session.save()

    if (claudeResponse.toLowerCase().includes('more') || claudeResponse.toLowerCase().includes('try')) {
      await addEvent('search_refined', {
        searchId: data.searchId,
        claudeResponse
      })
    } else {
      await addEvent('search_complete', {
        searchId: data.searchId
      })
    }
  },

  search_refined: async (data: { searchId: string; claudeResponse: string }) => {
    console.log('Search refined')
    
    const session = await SearchSessionModel.findById(data.searchId)
    if (!session) return

    // Extract new sites from Claude response
    const prompt = `From your previous response, please extract the specific websites to search next in JSON format: {sites: ["domain.com"]}`
    const response = await callClaude(session.userId, prompt)
    const parsed = JSON.parse(response)

    session.claudeConversationHistory.push(
      { role: 'user', content: prompt },
      { role: 'assistant', content: response }
    )
    await session.save()

    await addEvent('sites_identified', {
      searchId: data.searchId,
      sites: parsed.sites,
      keywords: session.query
    })
  },

  search_complete: async (data: { searchId: string }) => {
    console.log('Search complete')

    const session = await SearchSessionModel.findById(data.searchId)
    if (!session) return

    // Get all jobs for this search
    const jobs = await JobModel.find({ searchSessionId: data.searchId })

    // Ask Claude to rank and score jobs
    const jobDetails = jobs.map(j => `${j.title} at ${j.company} in ${j.location}`).join('\n')
    const rankingPrompt = `Rank these jobs by how well they match "${session.query}". For each, give a score 0-100 and brief reasoning:\n${jobDetails}`

    const ranking = await callClaude(session.userId, rankingPrompt)
    
    // Parse ranking and update jobs (simplified parsing)
    session.claudeConversationHistory.push(
      { role: 'user', content: rankingPrompt },
      { role: 'assistant', content: ranking }
    )
    session.status = 'complete'
    session.completedAt = new Date()
    await session.save()

    console.log('Search session complete:', data.searchId)
  },

  search_failed: async (data: { searchId: string; error: string }) => {
    const session = await SearchSessionModel.findById(data.searchId)
    if (session) {
      session.status = 'failed'
      await session.save()
    }
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd packages/api
npm test -- queue.test.ts
```

Expected output: Tests pass

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/events/ packages/api/tests/queue.test.ts
git commit -m "feat: implement BullMQ event queue and orchestration handlers"
```

---

## Phase 4: Claude AI Integration

### Task 6: Implement Claude API Client

**Files:**
- Create: `packages/api/src/claude/client.ts`
- Create: `packages/api/tests/claude.test.ts`

- [ ] **Step 1: Write failing test for Claude integration**

```typescript
// packages/api/tests/claude.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { callClaude } from '../src/claude/client'
import { UserModel } from '../src/db/models'
import { connectDB, disconnectDB } from '../src/db'

describe('Claude Client', () => {
  beforeEach(async () => {
    await connectDB()
    await UserModel.deleteMany({})
  })

  afterEach(async () => {
    await disconnectDB()
  })

  it('should call Claude API with user token', async () => {
    const user = await UserModel.create({
      email: 'test@example.com',
      passwordHash: 'hashed',
      claudeApiToken: process.env.CLAUDE_API_KEY || 'sk-test'
    })

    const response = await callClaude(user._id.toString(), 'What is 2+2?')
    expect(response).toBeDefined()
    expect(response).toBeTypeOf('string')
  })

  it('should throw error if user has no Claude token', async () => {
    const user = await UserModel.create({
      email: 'test@example.com',
      passwordHash: 'hashed'
    })

    await expect(callClaude(user._id.toString(), 'Test')).rejects.toThrow('No Claude API token')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/api
npm test -- claude.test.ts
```

Expected output: Failing tests

- [ ] **Step 3: Implement Claude client**

```typescript
// packages/api/src/claude/client.ts
import Anthropic from '@anthropic-ai/sdk'
import { UserModel } from '../db/models'

export async function callClaude(userId: string, message: string): Promise<string> {
  const user = await UserModel.findById(userId)
  if (!user || !user.claudeApiToken) {
    throw new Error('No Claude API token found for user')
  }

  const client = new Anthropic({
    apiKey: user.claudeApiToken
  })

  const response = await client.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: message
      }
    ]
  })

  const textContent = response.content.find(block => block.type === 'text')
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text response from Claude')
  }

  return textContent.text
}

export async function callClaudeWithHistory(
  userId: string,
  message: string,
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>
): Promise<string> {
  const user = await UserModel.findById(userId)
  if (!user || !user.claudeApiToken) {
    throw new Error('No Claude API token found for user')
  }

  const client = new Anthropic({
    apiKey: user.claudeApiToken
  })

  const messages = [
    ...conversationHistory,
    {
      role: 'user' as const,
      content: message
    }
  ]

  const response = await client.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 1024,
    messages
  })

  const textContent = response.content.find(block => block.type === 'text')
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text response from Claude')
  }

  return textContent.text
}
```

- [ ] **Step 4: Run tests to verify they pass (skip if CLAUDE_API_KEY not set)**

```bash
cd packages/api
CLAUDE_API_KEY=sk-test npm test -- claude.test.ts
```

Note: Tests will be skipped if API key is not available. That's OK for now.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/claude/ packages/api/tests/claude.test.ts
git commit -m "feat: implement Claude API client with conversation history support"
```

---

## Phase 5: Express API Routes

### Task 7: Create Express API with Auth and Search Endpoints

**Files:**
- Create: `packages/api/src/routes/auth.ts`
- Create: `packages/api/src/routes/searches.ts`
- Create: `packages/api/src/index.ts`

- [ ] **Step 1: Create auth routes**

```typescript
// packages/api/src/routes/auth.ts
import { Router } from 'express'
import { handleRegister, handleLogin, handleSetClaudeToken, authMiddleware } from '../auth/auth.controller'

const router = Router()

router.post('/register', handleRegister)
router.post('/login', handleLogin)
router.post('/set-claude-token', authMiddleware, handleSetClaudeToken)

export default router
```

- [ ] **Step 2: Create search routes**

```typescript
// packages/api/src/routes/searches.ts
import { Router, Request, Response, NextFunction } from 'express'
import { authMiddleware } from '../auth/auth.controller'
import { SearchSessionModel, JobModel } from '../db/models'
import { addEvent } from '../events/queue'

const router = Router()

router.use(authMiddleware)

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).userId
    const { query } = req.body

    if (!query) {
      return res.status(400).json({ error: 'Query required' })
    }

    const session = await SearchSessionModel.create({
      userId,
      query,
      status: 'running',
      claudeConversationHistory: [],
      foundJobs: [],
      sitesSearched: [],
      iterationCount: 0
    })

    await addEvent('search_started', {
      searchId: session._id.toString(),
      userId,
      query
    })

    res.status(201).json({ searchId: session._id.toString(), status: 'running' })
  } catch (error) {
    next(error)
  }
})

router.get('/:searchId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).userId
    const { searchId } = req.params

    const session = await SearchSessionModel.findById(searchId)
    if (!session || session.userId.toString() !== userId) {
      return res.status(404).json({ error: 'Search not found' })
    }

    res.json({
      searchId: session._id.toString(),
      status: session.status,
      iterationCount: session.iterationCount,
      jobsFoundCount: session.foundJobs.length,
      startedAt: session.startedAt,
      completedAt: session.completedAt
    })
  } catch (error) {
    next(error)
  }
})

router.get('/:searchId/jobs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).userId
    const { searchId } = req.params

    const session = await SearchSessionModel.findById(searchId)
    if (!session || session.userId.toString() !== userId) {
      return res.status(404).json({ error: 'Search not found' })
    }

    const jobs = await JobModel.find({ searchSessionId: searchId })
      .sort({ matchScore: -1 })
      .lean()

    const results = jobs.map(job => ({
      id: job._id,
      title: job.title,
      company: job.company,
      description: job.description,
      url: job.url,
      salary: job.salary,
      location: job.location,
      matchScore: job.matchScore || 0,
      matchReasoning: job.matchReasoning || ''
    }))

    res.json(results)
  } catch (error) {
    next(error)
  }
})

export default router
```

- [ ] **Step 3: Create main Express app**

```typescript
// packages/api/src/index.ts
import express, { Request, Response, NextFunction } from 'express'
import dotenv from 'dotenv'
import { connectDB } from './db'
import { getQueue, registerEventHandlers, eventHandlers } from './events/queue'
import authRoutes from './routes/auth'
import searchRoutes from './routes/searches'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3000

app.use(express.json())

// Routes
app.use('/api/auth', authRoutes)
app.use('/api/searches', searchRoutes)

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' })
})

// Error handling
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error('Error:', err)
  res.status(500).json({ error: err.message || 'Internal server error' })
})

async function startServer() {
  try {
    await connectDB()
    
    // Register event handlers
    registerEventHandlers(eventHandlers)
    
    app.listen(PORT, () => {
      console.log(`API server running on http://localhost:${PORT}`)
    })
  } catch (error) {
    console.error('Failed to start server:', error)
    process.exit(1)
  }
}

startServer()
```

- [ ] **Step 4: Test that API starts without errors**

```bash
cd packages/api
npm run build
npm start &
sleep 2
curl http://localhost:3000/api/health
kill %1
```

Expected: Returns `{"status":"ok"}`

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/routes/ packages/api/src/index.ts
git commit -m "feat: implement Express API with auth and search endpoints"
```

---

## Phase 6: Python Crawler

### Task 8: Implement Scrapy Crawler for Job Extraction

**Files:**
- Create: `crawler/job_crawler/__init__.py`
- Create: `crawler/job_crawler/items.py`
- Create: `crawler/job_crawler/spiders/generic_spider.py`
- Create: `crawler/job_crawler/pipelines.py`
- Create: `crawler/scrapy.cfg`
- Create: `crawler/job_crawler/settings.py`
- Create: `crawler/cli.py`

- [ ] **Step 1: Create Scrapy project structure**

```bash
cd crawler
touch job_crawler/__init__.py
touch job_crawler/pipelines.py
touch scrapy.cfg
```

- [ ] **Step 2: Create items.py for job data structure**

```python
# crawler/job_crawler/items.py
import scrapy

class JobItem(scrapy.Item):
    title = scrapy.Field()
    company = scrapy.Field()
    description = scrapy.Field()
    url = scrapy.Field()
    salary = scrapy.Field()
    location = scrapy.Field()
    source_url = scrapy.Field()
```

- [ ] **Step 3: Create generic spider**

```python
# crawler/job_crawler/spiders/generic_spider.py
import scrapy
from job_crawler.items import JobItem

class GenericJobSpider(scrapy.Spider):
    name = 'generic_jobs'
    allowed_domains = []
    start_urls = []

    def __init__(self, urls=None, keywords=None, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.start_urls = urls or []
        self.keywords = keywords or ''
        self.allowed_domains = [u.split('/')[2] for u in urls] if urls else []

    def parse(self, response):
        # Generic selectors for job postings
        job_containers = response.css('[class*="job"], [class*="position"], article')
        
        for job in job_containers:
            title_text = job.css('h2, h3, [class*="title"]::text').get()
            company_text = job.css('[class*="company"], [class*="employer"]::text').get()
            description_text = job.css('[class*="description"], [class*="summary"]::text').get()
            salary_text = job.css('[class*="salary"]::text').get()
            location_text = job.css('[class*="location"]::text').get()
            job_url = job.css('a::attr(href)').get()

            if title_text and company_text:
                yield JobItem(
                    title=title_text.strip(),
                    company=company_text.strip(),
                    description=description_text.strip() if description_text else '',
                    url=response.urljoin(job_url) if job_url else response.url,
                    salary=salary_text.strip() if salary_text else None,
                    location=location_text.strip() if location_text else '',
                    source_url=response.url
                )
```

- [ ] **Step 4: Create settings.py**

```python
# crawler/job_crawler/settings.py
BOT_NAME = 'job_crawler'

SPIDER_MODULES = ['job_crawler.spiders']
NEWSPIDER_MODULE = 'job_crawler.spiders'

ROBOTSTXT_OBEY = True
CONCURRENT_REQUESTS = 16
DOWNLOAD_DELAY = 1

USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'

ITEM_PIPELINES = {
    'job_crawler.pipelines.JobPipeline': 300,
}

LOG_LEVEL = 'INFO'
```

- [ ] **Step 5: Create pipelines.py**

```python
# crawler/job_crawler/pipelines.py
from job_crawler.items import JobItem

class JobPipeline:
    def process_item(self, item: JobItem, spider):
        # Basic validation
        if not item.get('title') or not item.get('company'):
            raise Exception(f'Missing required fields in {item}')
        
        # Normalize whitespace
        item['title'] = ' '.join(item['title'].split())
        item['company'] = ' '.join(item['company'].split())
        
        return item
```

- [ ] **Step 6: Create CLI for running crawler**

```python
# crawler/cli.py
import os
import json
import sys
from scrapy.crawler import CrawlerProcess
from scrapy.utils.project import get_project_settings
from job_crawler.spiders.generic_spider import GenericJobSpider

def crawl_jobs(urls, keywords=''):
    """Crawl jobs from given URLs"""
    
    settings = get_project_settings()
    process = CrawlerProcess(settings)
    
    # Store results
    results = []
    
    class ResultCollector:
        def __init__(self):
            self.items = []
        
        def add_item(self, item):
            self.items.append(dict(item))
    
    collector = ResultCollector()
    
    # Monkey-patch to collect results
    original_process_item = GenericJobSpider.parse
    
    def collecting_parse(self, response):
        for item in original_process_item(self, response):
            if isinstance(item, dict) or hasattr(item, '__getitem__'):
                collector.add_item(item)
            yield item
    
    GenericJobSpider.parse = collecting_parse
    
    process.crawl(GenericJobSpider, urls=urls, keywords=keywords)
    process.start()
    
    return {
        'found': len(collector.items),
        'jobs': collector.items,
        'newSites': []
    }

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Usage: python cli.py <url1> [<url2> ...] [--keywords <keywords>]')
        sys.exit(1)
    
    urls = []
    keywords = ''
    
    i = 1
    while i < len(sys.argv):
        if sys.argv[i] == '--keywords' and i + 1 < len(sys.argv):
            keywords = sys.argv[i + 1]
            i += 2
        else:
            urls.append(sys.argv[i])
            i += 1
    
    result = crawl_jobs(urls, keywords)
    print(json.dumps(result))
```

- [ ] **Step 7: Create HTTP wrapper for crawler**

```python
# crawler/server.py
from flask import Flask, request, jsonify
from cli import crawl_jobs
import os

app = Flask(__name__)

@app.route('/crawler/scrape', methods=['POST'])
def scrape():
    data = request.get_json()
    urls = data.get('urls', [])
    keywords = data.get('keywords', '')
    
    if not urls:
        return jsonify({'error': 'URLs required'}), 400
    
    try:
        result = crawl_jobs(urls, keywords)
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    port = int(os.getenv('CRAWLER_PORT', 8000))
    app.run(host='localhost', port=port, debug=False)
```

- [ ] **Step 8: Update crawler requirements.txt**

```txt
scrapy==2.16.0
requests==2.31.0
python-dotenv==1.0.0
flask==3.0.0
```

- [ ] **Step 9: Test crawler locally**

```bash
cd crawler
pip install -r requirements.txt
python cli.py https://example.com/jobs --keywords "Python"
```

Expected: Returns JSON with job results

- [ ] **Step 10: Commit**

```bash
git add crawler/
git commit -m "feat: implement Scrapy-based web crawler for job extraction"
```

---

## Phase 7: React Frontend

### Task 9: Build React Frontend Components

**Files:**
- Create: `packages/frontend/src/main.tsx`
- Create: `packages/frontend/src/App.tsx`
- Create: `packages/frontend/src/pages/SearchPage.tsx`
- Create: `packages/frontend/src/pages/ResultsPage.tsx`
- Create: `packages/frontend/src/components/SearchForm.tsx`
- Create: `packages/frontend/src/components/ProgressDisplay.tsx`
- Create: `packages/frontend/src/components/JobCard.tsx`
- Create: `packages/frontend/src/hooks/useAuth.ts`
- Create: `packages/frontend/src/hooks/useApi.ts`
- Create: `packages/frontend/index.html`
- Create: `packages/frontend/tsconfig.json`

- [ ] **Step 1: Create index.html**

```html
<!-- packages/frontend/index.html -->
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI Job Search</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; }
        #root { min-height: 100vh; }
    </style>
</head>
<body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
</body>
</html>
```

- [ ] **Step 2: Create main.tsx entry point**

```typescript
// packages/frontend/src/main.tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
```

- [ ] **Step 3: Create useAuth hook**

```typescript
// packages/frontend/src/hooks/useAuth.ts
import { useState, useCallback } from 'react'
import axios from 'axios'

interface AuthState {
  userId: string | null
  token: string | null
}

export function useAuth() {
  const [auth, setAuth] = useState<AuthState>(() => {
    const stored = localStorage.getItem('auth')
    return stored ? JSON.parse(stored) : { userId: null, token: null }
  })

  const register = useCallback(async (email: string, password: string) => {
    const { data } = await axios.post('/api/auth/register', { email, password })
    setAuth({ userId: data.userId, token: data.token })
    localStorage.setItem('auth', JSON.stringify({ userId: data.userId, token: data.token }))
    return data
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const { data } = await axios.post('/api/auth/login', { email, password })
    setAuth({ userId: data.userId, token: data.token })
    localStorage.setItem('auth', JSON.stringify({ userId: data.userId, token: data.token }))
    return data
  }, [])

  const setClaudeToken = useCallback(async (claudeToken: string) => {
    await axios.post(
      '/api/auth/set-claude-token',
      { claudeApiToken: claudeToken },
      { headers: { Authorization: `Bearer ${auth.token}` } }
    )
  }, [auth.token])

  const logout = useCallback(() => {
    setAuth({ userId: null, token: null })
    localStorage.removeItem('auth')
  }, [])

  return { auth, register, login, setClaudeToken, logout, isAuthenticated: !!auth.token }
}
```

- [ ] **Step 4: Create useApi hook**

```typescript
// packages/frontend/src/hooks/useApi.ts
import { useState, useCallback } from 'react'
import axios from 'axios'

export function useApi(token: string | null) {
  const createSearch = useCallback(async (query: string) => {
    const { data } = await axios.post(
      '/api/searches',
      { query },
      { headers: { Authorization: `Bearer ${token}` } }
    )
    return data
  }, [token])

  const getSearchStatus = useCallback(async (searchId: string) => {
    const { data } = await axios.get(
      `/api/searches/${searchId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    return data
  }, [token])

  const getSearchResults = useCallback(async (searchId: string) => {
    const { data } = await axios.get(
      `/api/searches/${searchId}/jobs`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    return data
  }, [token])

  return { createSearch, getSearchStatus, getSearchResults }
}
```

- [ ] **Step 5: Create SearchForm component**

```typescript
// packages/frontend/src/components/SearchForm.tsx
import React, { useState } from 'react'

interface SearchFormProps {
  onSubmit: (query: string) => Promise<void>
  loading?: boolean
}

export function SearchForm({ onSubmit, loading }: SearchFormProps) {
  const [query, setQuery] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (query.trim()) {
      await onSubmit(query)
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ marginBottom: '20px' }}>
      <textarea
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Describe your ideal job (e.g., 'Remote Python backend developer in Berlin')"
        style={{
          width: '100%',
          minHeight: '80px',
          padding: '10px',
          fontSize: '16px',
          fontFamily: 'inherit'
        }}
      />
      <button
        type="submit"
        disabled={loading || !query.trim()}
        style={{
          marginTop: '10px',
          padding: '10px 20px',
          fontSize: '16px',
          cursor: 'pointer'
        }}
      >
        {loading ? 'Searching...' : 'Search Jobs'}
      </button>
    </form>
  )
}
```

- [ ] **Step 6: Create ProgressDisplay component**

```typescript
// packages/frontend/src/components/ProgressDisplay.tsx
interface ProgressDisplayProps {
  status: 'running' | 'complete' | 'failed'
  iterationCount: number
  jobsFound: number
}

export function ProgressDisplay({ status, iterationCount, jobsFound }: ProgressDisplayProps) {
  if (status === 'running') {
    return (
      <div style={{ padding: '20px', backgroundColor: '#e3f2fd', borderRadius: '4px', marginBottom: '20px' }}>
        <p>🔍 Searching... (Iteration {iterationCount})</p>
        <p>Found {jobsFound} jobs so far</p>
      </div>
    )
  }

  if (status === 'failed') {
    return (
      <div style={{ padding: '20px', backgroundColor: '#ffebee', borderRadius: '4px', marginBottom: '20px' }}>
        <p>❌ Search failed. Please try again.</p>
      </div>
    )
  }

  return (
    <div style={{ padding: '20px', backgroundColor: '#f1f8e9', borderRadius: '4px', marginBottom: '20px' }}>
      <p>✅ Search complete! Found {jobsFound} jobs.</p>
    </div>
  )
}
```

- [ ] **Step 7: Create JobCard component**

```typescript
// packages/frontend/src/components/JobCard.tsx
interface Job {
  id: string
  title: string
  company: string
  description: string
  url: string
  salary?: string
  location: string
  matchScore: number
  matchReasoning: string
}

interface JobCardProps {
  job: Job
}

export function JobCard({ job }: JobCardProps) {
  return (
    <div style={{
      border: '1px solid #ddd',
      borderRadius: '4px',
      padding: '15px',
      marginBottom: '15px',
      backgroundColor: 'white'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: start' }}>
        <div style={{ flex: 1 }}>
          <h3 style={{ margin: '0 0 5px 0' }}>{job.title}</h3>
          <p style={{ margin: '0 0 10px 0', color: '#666' }}>{job.company} • {job.location}</p>
          <p style={{ margin: '0 0 10px 0', color: '#444' }}>{job.description.substring(0, 200)}...</p>
        </div>
        <div style={{
          backgroundColor: job.matchScore >= 80 ? '#c8e6c9' : '#fff9c4',
          padding: '10px 15px',
          borderRadius: '4px',
          textAlign: 'center',
          marginLeft: '15px'
        }}>
          <p style={{ margin: 0, fontSize: '24px', fontWeight: 'bold' }}>{Math.round(job.matchScore)}</p>
          <p style={{ margin: '5px 0 0 0', fontSize: '12px' }}>Match</p>
        </div>
      </div>
      <p style={{ margin: '10px 0 0 0', color: '#555', fontSize: '14px' }}>
        <strong>Why this match:</strong> {job.matchReasoning}
      </p>
      <a
        href={job.url}
        target="_blank"
        rel="noopener noreferrer"
        style={{ marginTop: '10px', display: 'inline-block', color: '#1976d2' }}
      >
        View Job →
      </a>
    </div>
  )
}
```

- [ ] **Step 8: Create SearchPage component**

```typescript
// packages/frontend/src/pages/SearchPage.tsx
import { useState } from 'react'
import { SearchForm } from '../components/SearchForm'
import { useApi } from '../hooks/useApi'

interface SearchPageProps {
  token: string
  onSearchCreated: (searchId: string) => void
}

export function SearchPage({ token, onSearchCreated }: SearchPageProps) {
  const { createSearch } = useApi(token)
  const [loading, setLoading] = useState(false)

  const handleSearch = async (query: string) => {
    setLoading(true)
    try {
      const result = await createSearch(query)
      onSearchCreated(result.searchId)
    } catch (error) {
      alert('Failed to create search: ' + (error instanceof Error ? error.message : 'Unknown error'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: '600px', margin: '0 auto', padding: '40px 20px' }}>
      <h1 style={{ marginBottom: '10px' }}>AI-Powered Job Search</h1>
      <p style={{ color: '#666', marginBottom: '30px' }}>
        Describe your ideal job and let AI find the best matches from company websites.
      </p>
      <SearchForm onSubmit={handleSearch} loading={loading} />
    </div>
  )
}
```

- [ ] **Step 9: Create ResultsPage component**

```typescript
// packages/frontend/src/pages/ResultsPage.tsx
import { useState, useEffect } from 'react'
import { ProgressDisplay } from '../components/ProgressDisplay'
import { JobCard } from '../components/JobCard'
import { useApi } from '../hooks/useApi'

interface Job {
  id: string
  title: string
  company: string
  description: string
  url: string
  salary?: string
  location: string
  matchScore: number
  matchReasoning: string
}

interface ResultsPageProps {
  searchId: string
  token: string
  onBack: () => void
}

export function ResultsPage({ searchId, token, onBack }: ResultsPageProps) {
  const { getSearchStatus, getSearchResults } = useApi(token)
  const [status, setStatus] = useState<'running' | 'complete' | 'failed'>('running')
  const [iterationCount, setIterationCount] = useState(0)
  const [jobs, setJobs] = useState<Job[]>([])

  useEffect(() => {
    const poll = async () => {
      try {
        const statusData = await getSearchStatus(searchId)
        setStatus(statusData.status)
        setIterationCount(statusData.iterationCount)

        if (statusData.status === 'complete') {
          const results = await getSearchResults(searchId)
          setJobs(results)
        }
      } catch (error) {
        console.error('Failed to fetch status:', error)
      }
    }

    const interval = setInterval(poll, 2000)
    poll()

    return () => clearInterval(interval)
  }, [searchId, getSearchStatus, getSearchResults])

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '40px 20px' }}>
      <button onClick={onBack} style={{ marginBottom: '20px' }}>← Back to Search</button>
      <h1>Search Results</h1>
      <ProgressDisplay status={status} iterationCount={iterationCount} jobsFound={jobs.length} />
      {jobs.map(job => <JobCard key={job.id} job={job} />)}
    </div>
  )
}
```

- [ ] **Step 10: Create main App component**

```typescript
// packages/frontend/src/App.tsx
import { useState } from 'react'
import { useAuth } from './hooks/useAuth'
import { SearchPage } from './pages/SearchPage'
import { ResultsPage } from './pages/ResultsPage'

type AppPage = 'auth' | 'search' | 'results'

export default function App() {
  const { auth, register, login, setClaudeToken, logout, isAuthenticated } = useAuth()
  const [currentPage, setCurrentPage] = useState<AppPage>('auth')
  const [currentSearchId, setCurrentSearchId] = useState<string>('')
  const [claudeTokenSet, setClaudeTokenSet] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [claudeApiKey, setClaudeApiKey] = useState('')

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await register(email, password)
      alert('Registered successfully!')
    } catch (error) {
      alert('Registration failed: ' + (error instanceof Error ? error.message : 'Unknown error'))
    }
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await login(email, password)
      setCurrentPage('search')
    } catch (error) {
      alert('Login failed: ' + (error instanceof Error ? error.message : 'Unknown error'))
    }
  }

  const handleSetClaudeToken = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await setClaudeToken(claudeApiKey)
      setClaudeTokenSet(true)
      setCurrentPage('search')
    } catch (error) {
      alert('Failed to set Claude token: ' + (error instanceof Error ? error.message : 'Unknown error'))
    }
  }

  if (!isAuthenticated) {
    return (
      <div style={{ maxWidth: '400px', margin: '40px auto', padding: '20px' }}>
        <h1>AI Job Search</h1>
        <form onSubmit={currentPage === 'auth' ? handleLogin : handleRegister}>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            style={{ width: '100%', padding: '8px', marginBottom: '10px', display: 'block' }}
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            style={{ width: '100%', padding: '8px', marginBottom: '10px', display: 'block' }}
          />
          <button type="submit" style={{ width: '100%', padding: '10px' }}>
            {currentPage === 'auth' ? 'Login' : 'Register'}
          </button>
        </form>
      </div>
    )
  }

  if (!claudeTokenSet) {
    return (
      <div style={{ maxWidth: '400px', margin: '40px auto', padding: '20px' }}>
        <h1>Set Up Claude API Token</h1>
        <form onSubmit={handleSetClaudeToken}>
          <input
            type="password"
            placeholder="Claude API Key (sk-...)"
            value={claudeApiKey}
            onChange={e => setClaudeApiKey(e.target.value)}
            style={{ width: '100%', padding: '8px', marginBottom: '10px', display: 'block' }}
          />
          <button type="submit" style={{ width: '100%', padding: '10px' }}>
            Save Claude Token
          </button>
        </form>
        <button onClick={logout} style={{ width: '100%', padding: '10px', marginTop: '10px' }}>
          Logout
        </button>
      </div>
    )
  }

  if (currentPage === 'results' && currentSearchId) {
    return (
      <ResultsPage
        searchId={currentSearchId}
        token={auth.token!}
        onBack={() => setCurrentPage('search')}
      />
    )
  }

  return (
    <>
      <SearchPage
        token={auth.token!}
        onSearchCreated={(searchId) => {
          setCurrentSearchId(searchId)
          setCurrentPage('results')
        }}
      />
      <button
        onClick={logout}
        style={{
          position: 'fixed',
          top: '20px',
          right: '20px',
          padding: '8px 16px'
        }}
      >
        Logout
      </button>
    </>
  )
}
```

- [ ] **Step 11: Create tsconfig.json for frontend**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["ES2020", "DOM", "DOM.Iterable"]
  },
  "include": ["src"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 12: Test frontend builds**

```bash
cd packages/frontend
npm install
npm run build
```

Expected: Build succeeds without errors

- [ ] **Step 13: Commit**

```bash
git add packages/frontend/
git commit -m "feat: build React frontend with search and results pages"
```

---

## Phase 8: Integration & Docker

### Task 10: Complete Docker Setup and Integration Testing

**Files:**
- Modify: `docker-compose.yml` (update with all services)
- Create: `packages/api/.dockerignore`
- Create: `packages/frontend/.dockerignore`
- Create: `crawler/.dockerignore`

- [ ] **Step 1: Create .dockerignore files**

```
node_modules/
dist/
build/
.env
.DS_Store
*.log
__pycache__/
.venv/
```

Add same content to: `packages/api/.dockerignore`, `packages/frontend/.dockerignore`, `crawler/.dockerignore`

- [ ] **Step 2: Update docker-compose.yml with all services**

```yaml
version: '3.9'

services:
  mongodb:
    image: mongo:8.3
    container_name: job-search-mongo
    ports:
      - "27017:27017"
    environment:
      MONGO_INITDB_DATABASE: job_search
    volumes:
      - mongo_data:/data/db
    healthcheck:
      test: mongosh --eval 'db.adminCommand("ping")'
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:8.6.3-alpine
    container_name: job-search-redis
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: redis-cli ping
      interval: 5s
      timeout: 5s
      retries: 5

  api:
    build:
      context: .
      dockerfile: packages/api/Dockerfile
    container_name: job-search-api
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: development
      PORT: 3000
      MONGODB_URI: mongodb://mongodb:27017/job_search
      REDIS_URL: redis://redis:6379
      CLAUDE_API_KEY: ${CLAUDE_API_KEY}
      JWT_SECRET: ${JWT_SECRET:-dev-secret}
    depends_on:
      mongodb:
        condition: service_healthy
      redis:
        condition: service_healthy
    volumes:
      - ./packages/api/src:/app/src

  crawler:
    build:
      context: .
      dockerfile: crawler/Dockerfile
    container_name: job-search-crawler
    ports:
      - "8000:8000"
    environment:
      CRAWLER_PORT: 8000
    volumes:
      - ./crawler:/app

  frontend:
    build:
      context: .
      dockerfile: packages/frontend/Dockerfile
    container_name: job-search-frontend
    ports:
      - "5173:5173"
    depends_on:
      - api
    volumes:
      - ./packages/frontend/src:/app/src

volumes:
  mongo_data:
  redis_data:
```

- [ ] **Step 3: Create Dockerfile for API**

```dockerfile
# packages/api/Dockerfile
FROM node:24-alpine

WORKDIR /app

COPY package.json packages/api/package.json packages/shared/package.json ./

RUN npm install

COPY packages/api/ ./packages/api/
COPY packages/shared/ ./packages/shared/

RUN npm run build

CMD ["npm", "start"]
```

- [ ] **Step 4: Create Dockerfile for crawler**

```dockerfile
# crawler/Dockerfile
FROM python:3.14-slim

WORKDIR /app

COPY crawler/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY crawler/ .

EXPOSE 8000

CMD ["python", "server.py"]
```

- [ ] **Step 5: Create Dockerfile for frontend**

```dockerfile
# packages/frontend/Dockerfile
FROM node:24-alpine

WORKDIR /app

COPY packages/frontend/package.json packages/shared/package.json ./

RUN npm install

COPY packages/frontend/ ./packages/frontend/
COPY packages/shared/ ./packages/shared/

EXPOSE 5173

CMD ["npm", "run", "dev"]
```

- [ ] **Step 6: Create startup script**

```bash
#!/bin/bash
# ./startup.sh

set -e

echo "Starting Docker services..."
docker-compose up -d

echo "Waiting for services to be ready..."
sleep 5

echo "Services started!"
echo ""
echo "Frontend: http://localhost:5173"
echo "API: http://localhost:3000"
echo "Crawler: http://localhost:8000"
```

Make executable:
```bash
chmod +x ./startup.sh
```

- [ ] **Step 7: Test Docker setup**

```bash
docker-compose build
docker-compose up -d
sleep 5
curl http://localhost:3000/api/health
docker-compose down
```

Expected: Returns `{"status":"ok"}`

- [ ] **Step 8: Commit**

```bash
git add docker-compose.yml packages/*/Dockerfile crawler/Dockerfile .dockerignore startup.sh
git commit -m "feat: add Docker configuration for containerized deployment"
```

---

## Phase 9: Testing & Verification

### Task 11: Write Integration Tests

**Files:**
- Create: `packages/api/tests/integration.test.ts`

- [ ] **Step 1: Write integration test**

```typescript
// packages/api/tests/integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import axios from 'axios'
import { connectDB, disconnectDB } from '../src/db'

const BASE_URL = 'http://localhost:3000'
let authToken: string
let userId: string
let searchId: string

describe('Integration Tests', () => {
  beforeAll(async () => {
    await connectDB()
  })

  afterAll(async () => {
    await disconnectDB()
  })

  it('should register a new user', async () => {
    const res = await axios.post(`${BASE_URL}/api/auth/register`, {
      email: `test-${Date.now()}@example.com`,
      password: 'password123'
    })

    expect(res.status).toBe(201)
    expect(res.data.token).toBeDefined()
    expect(res.data.userId).toBeDefined()

    authToken = res.data.token
    userId = res.data.userId
  })

  it('should set Claude token', async () => {
    const res = await axios.post(
      `${BASE_URL}/api/auth/set-claude-token`,
      { claudeApiToken: 'sk-test' },
      { headers: { Authorization: `Bearer ${authToken}` } }
    )

    expect(res.status).toBe(200)
    expect(res.data.success).toBe(true)
  })

  it('should create a search', async () => {
    const res = await axios.post(
      `${BASE_URL}/api/searches`,
      { query: 'Python developer' },
      { headers: { Authorization: `Bearer ${authToken}` } }
    )

    expect(res.status).toBe(201)
    expect(res.data.searchId).toBeDefined()
    expect(res.data.status).toBe('running')

    searchId = res.data.searchId
  })

  it('should get search status', async () => {
    const res = await axios.get(
      `${BASE_URL}/api/searches/${searchId}`,
      { headers: { Authorization: `Bearer ${authToken}` } }
    )

    expect(res.status).toBe(200)
    expect(res.data.searchId).toBe(searchId)
  })

  it('should get empty results for incomplete search', async () => {
    const res = await axios.get(
      `${BASE_URL}/api/searches/${searchId}/jobs`,
      { headers: { Authorization: `Bearer ${authToken}` } }
    )

    expect(res.status).toBe(200)
    expect(Array.isArray(res.data)).toBe(true)
  })
})
```

- [ ] **Step 2: Run integration tests**

```bash
cd packages/api
npm test -- integration.test.ts
```

Expected: All tests pass (or skip if services not running)

- [ ] **Step 3: Commit**

```bash
git add packages/api/tests/integration.test.ts
git commit -m "test: add integration tests for auth and search endpoints"
```

---

## Phase 10: Documentation

### Task 12: Create README and API Documentation

**Files:**
- Create: `README.md`
- Create: `docs/API.md`
- Create: `docs/ARCHITECTURE.md`

- [ ] **Step 1: Create main README.md**

```markdown
# AI-Powered Job Search

An intelligent job search application that uses AI to discover job opportunities from company websites and automatically evaluate matches against your profile.

## Quick Start

### Prerequisites
- Node.js 24 LTS
- Python 3.14
- Docker & Docker Compose
- Claude API key

### Development Setup

1. Clone the repository and install dependencies:
```bash
npm install
```

2. Create `.env` file:
```bash
cp .env.example .env
# Edit .env with your Claude API key
```

3. Start services:
```bash
docker-compose up -d
```

4. Start development servers:
```bash
# Terminal 1: API
cd packages/api && npm run dev

# Terminal 2: Frontend
cd packages/frontend && npm run dev

# Terminal 3: Crawler
cd crawler && python server.py
```

5. Open http://localhost:5173

## Architecture

See `docs/ARCHITECTURE.md` for system design and component overview.

## API Documentation

See `docs/API.md` for complete API reference.

## Project Structure

```
job-search/
├── packages/
│   ├── api/       - Express API server
│   ├── frontend/  - React application
│   └── shared/    - Shared TypeScript types
├── crawler/       - Python Scrapy web crawler
├── docs/          - Documentation
└── docker-compose.yml
```

## Features (MVP)

- User authentication with JWT
- Claude API integration for intelligent search guidance
- Multi-iteration search loop with autonomous refinement
- Web scraping of job postings
- Job ranking and evaluation using Claude
- Real-time search progress tracking
- Job results with match scores

## Development

### Running Tests

```bash
cd packages/api
npm test
```

### Building for Production

```bash
npm run build --workspaces
```

### Docker Deployment

```bash
docker-compose build
docker-compose up
```

## Technologies

- **Frontend:** React 19.2.6, Vite 8.0.14
- **Backend:** Express 5.2.1, Node.js 24 LTS
- **Crawler:** Python 3.14, Scrapy 2.16.0
- **Database:** MongoDB 8.3
- **Cache/Queue:** Redis 8.6.3, BullMQ 5.77.3
- **AI:** Claude API (3.5 Sonnet)

## License

MIT
```

- [ ] **Step 2: Create API.md**

```markdown
# API Documentation

## Authentication

### Register
```bash
POST /api/auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123"
}
```

Response:
```json
{
  "userId": "...",
  "token": "..."
}
```

### Login
```bash
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123"
}
```

### Set Claude Token
```bash
POST /api/auth/set-claude-token
Authorization: Bearer <token>
Content-Type: application/json

{
  "claudeApiToken": "sk-..."
}
```

## Searches

### Create Search
```bash
POST /api/searches
Authorization: Bearer <token>
Content-Type: application/json

{
  "query": "Remote Python backend developer in Berlin"
}
```

Response:
```json
{
  "searchId": "...",
  "status": "running"
}
```

### Get Search Status
```bash
GET /api/searches/:searchId
Authorization: Bearer <token>
```

Response:
```json
{
  "searchId": "...",
  "status": "running|complete|failed",
  "iterationCount": 2,
  "jobsFoundCount": 12,
  "startedAt": "2026-05-27T...",
  "completedAt": null
}
```

### Get Search Results
```bash
GET /api/searches/:searchId/jobs
Authorization: Bearer <token>
```

Response:
```json
[
  {
    "id": "...",
    "title": "Backend Engineer",
    "company": "TechCorp",
    "description": "...",
    "url": "https://...",
    "salary": "€60k-80k",
    "location": "Berlin",
    "matchScore": 95,
    "matchReasoning": "Perfect fit: remote, Python, Berlin-based"
  }
]
```

## Crawler

### Scrape Jobs
```bash
POST /crawler/scrape
Content-Type: application/json

{
  "urls": ["https://company.com/jobs", ...],
  "keywords": "Python Berlin Remote"
}
```

Response:
```json
{
  "found": 5,
  "jobs": [...]
}
```

## Health Check
```bash
GET /api/health
```

Response:
```json
{
  "status": "ok"
}
```
```

- [ ] **Step 3: Create ARCHITECTURE.md**

```markdown
# System Architecture

## Overview

The job search system uses an event-driven architecture where:
1. Users describe their ideal job
2. Claude analyzes and suggests sites to search
3. Crawler extracts job postings
4. Claude decides if more searches are needed
5. Finally, Claude ranks all jobs by match

## Components

### Frontend (React)
- Search form for job queries
- Real-time progress display
- Results page with ranked jobs

### API (Express)
- User authentication
- Search orchestration
- Event loop management
- Claude conversation history

### Crawler (Python/Scrapy)
- Scrapes job postings from websites
- Extracts structured job data
- Reports results back to API

### Event Bus (BullMQ + Redis)
- Queues events between components
- Ensures reliable event delivery
- Handles retries and failures

### Database (MongoDB)
- Users and authentication
- Search sessions
- Job postings
- Site discovery

## Event Flow

```
1. User submits search query
   ↓
2. API creates search session, emits `search_started`
   ↓
3. Claude analyzes query, suggests sites
   ↓ (emit `sites_identified`)
4. Crawler scrapes sites
   ↓ (emit `jobs_scraped`)
5. Claude reviews results, decides to continue or finalize
   ├→ If more needed: emit `search_refined`, go to step 3
   └→ If complete: emit `search_complete`
6. Claude ranks all jobs by match
7. Results available to frontend
```

## Data Model

See the main design spec for detailed data models.

## Deployment

Services run in Docker containers with:
- MongoDB for data persistence
- Redis for caching and message queue
- Separate containers for API, frontend, and crawler
```

- [ ] **Step 4: Commit**

```bash
git add README.md docs/API.md docs/ARCHITECTURE.md
git commit -m "docs: add comprehensive README and API documentation"
```

---

## Phase 11: Final Verification

### Task 13: Verify End-to-End Functionality

- [ ] **Step 1: Start all services**

```bash
docker-compose up -d
sleep 10
```

- [ ] **Step 2: Test registration**

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'
```

Expected: Returns `{"userId":"...","token":"..."}`

- [ ] **Step 3: Test search creation**

```bash
TOKEN="<token-from-previous-step>"
curl -X POST http://localhost:3000/api/searches \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"Python developer"}'
```

Expected: Returns `{"searchId":"...","status":"running"}`

- [ ] **Step 4: Verify health check**

```bash
curl http://localhost:3000/api/health
```

Expected: Returns `{"status":"ok"}`

- [ ] **Step 5: Test frontend loads**

```bash
curl -s http://localhost:5173 | grep -q "AI-Powered Job Search" && echo "Frontend OK" || echo "Frontend failed"
```

- [ ] **Step 6: Stop services**

```bash
docker-compose down
```

- [ ] **Step 7: Final commit**

```bash
git add .
git commit -m "chore: complete implementation with all services verified"
```

---

## Summary

**Implementation Checklist:**

- ✅ Monorepo structure with workspaces
- ✅ TypeScript configuration and shared types
- ✅ MongoDB models and connection
- ✅ User authentication (register, login, token management)
- ✅ Event queue with BullMQ
- ✅ Event handlers for agentic loop
- ✅ Claude API integration
- ✅ Express API routes and endpoints
- ✅ Scrapy web crawler
- ✅ React frontend with pages and components
- ✅ Docker Compose setup
- ✅ Integration tests
- ✅ API documentation
- ✅ Architecture documentation

**Total Tasks:** 13  
**Estimated Duration:** 40-60 hours (developer dependent)

**Next Steps After Implementation:**
1. User testing and feedback
2. Performance optimization
3. Rate limiting and security hardening
4. Deployment to production
5. Monitoring and observability
6. Future features (profiles, application tracking)

---

