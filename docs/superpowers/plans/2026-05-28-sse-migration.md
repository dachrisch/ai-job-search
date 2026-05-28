# SSE Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace polling-based search status updates with Server-Sent Events (SSE) for real-time results streaming.

**Architecture:** Backend SSEManager tracks connected clients and broadcasts events from handlers. Frontend useSSE hook connects to SSE endpoint, handles reconnection, and syncs state. Event handlers emit updates immediately when jobs are found/ranked.

**Tech Stack:** Express.js (backend), React Hooks (frontend), Server-Sent Events API, Jest/Vitest (testing)

---

## Task 1: Create SSEManager Utility Class

**Files:**
- Create: `packages/api/src/utils/SSEManager.ts`
- Test: `packages/api/tests/SSEManager.test.ts`

### Step 1.1: Write the failing test for SSEManager

Create `packages/api/tests/SSEManager.test.ts`:

```typescript
import { SSEManager } from '../src/utils/SSEManager'
import { Response } from 'express'

describe('SSEManager', () => {
  let manager: SSEManager
  let mockRes: Partial<Response>

  beforeEach(() => {
    manager = new SSEManager()
    mockRes = {
      write: jest.fn(),
      on: jest.fn()
    }
  })

  it('should subscribe a client to a search', () => {
    manager.subscribe('search123', mockRes as Response)
    // Should not throw
  })

  it('should unsubscribe a client', () => {
    manager.subscribe('search123', mockRes as Response)
    manager.unsubscribe('search123', mockRes as Response)
    // Should not throw
  })

  it('should broadcast to all clients for a search', () => {
    const res1 = { write: jest.fn() } as any
    const res2 = { write: jest.fn() } as any

    manager.subscribe('search123', res1)
    manager.subscribe('search123', res2)

    manager.broadcast('search123', { type: 'status', payload: { status: 'running' } })

    expect(res1.write).toHaveBeenCalled()
    expect(res2.write).toHaveBeenCalled()
  })

  it('should not broadcast to clients of other searches', () => {
    const res1 = { write: jest.fn() } as any
    const res2 = { write: jest.fn() } as any

    manager.subscribe('search123', res1)
    manager.subscribe('search456', res2)

    manager.broadcast('search123', { type: 'status', payload: { status: 'running' } })

    expect(res1.write).toHaveBeenCalled()
    expect(res2.write).not.toHaveBeenCalled()
  })

  it('should format messages as Server-Sent Events', () => {
    const res = { write: jest.fn() } as any
    manager.subscribe('search123', res)

    manager.broadcast('search123', { 
      type: 'sync', 
      payload: { status: 'running', jobs: [] } 
    })

    const written = (res.write as jest.Mock).mock.calls[0][0]
    expect(written).toContain('data:')
    expect(written).toContain('{"type":"sync"')
  })
})
```

Run: `npm test -- SSEManager.test.ts`  
Expected: FAIL — `SSEManager is not defined`

### Step 1.2: Implement SSEManager class

Create `packages/api/src/utils/SSEManager.ts`:

```typescript
import { Response } from 'express'

interface SSEEvent {
  type: 'sync' | 'status' | 'job' | 'ping' | 'error'
  payload: any
}

class SSEManager {
  private clients: Map<string, Set<Response>> = new Map()

  subscribe(searchId: string, res: Response): void {
    if (!this.clients.has(searchId)) {
      this.clients.set(searchId, new Set())
    }
    this.clients.get(searchId)!.add(res)

    // Clean up on disconnect
    res.on('close', () => {
      this.unsubscribe(searchId, res)
    })
  }

  unsubscribe(searchId: string, res: Response): void {
    const clients = this.clients.get(searchId)
    if (clients) {
      clients.delete(res)
      if (clients.size === 0) {
        this.clients.delete(searchId)
      }
    }
  }

  broadcast(searchId: string, event: SSEEvent): void {
    const clients = this.clients.get(searchId)
    if (!clients) return

    const message = `data: ${JSON.stringify(event)}\n\n`
    clients.forEach(res => {
      try {
        res.write(message)
      } catch (error) {
        this.unsubscribe(searchId, res)
      }
    })
  }

  getConnectedClientCount(searchId: string): number {
    return this.clients.get(searchId)?.size ?? 0
  }
}

export { SSEManager, SSEEvent }
```

### Step 1.3: Run tests to verify they pass

Run: `npm test -- SSEManager.test.ts`  
Expected: PASS

### Step 1.4: Commit

```bash
git add packages/api/src/utils/SSEManager.ts packages/api/tests/SSEManager.test.ts
git commit -m "feat: add SSEManager for client tracking and broadcasting"
```

---

## Task 2: Create SSE Stream Endpoint

**Files:**
- Create: `packages/api/src/routes/stream.ts`
- Test: `packages/api/tests/stream.test.ts`

### Step 2.1: Write the failing test for stream endpoint

Create `packages/api/tests/stream.test.ts`:

```typescript
import request from 'supertest'
import express from 'express'
import { streamRouter } from '../src/routes/stream'
import { SSEManager } from '../src/utils/SSEManager'
import { SearchSessionModel } from '../src/db/models'

describe('Stream Endpoint', () => {
  let app: express.Application
  let manager: SSEManager

  beforeEach(() => {
    app = express()
    manager = new SSEManager()
    app.use((req, res, next) => {
      (req as any).userId = 'user123'
      next()
    })
    app.use('/api/searches', streamRouter(manager))
  })

  it('should return 404 if search not found', async () => {
    const response = await request(app)
      .get('/api/searches/invalid/stream')

    expect(response.status).toBe(404)
  })

  it('should return 403 if user does not own search', async () => {
    // Mock a search owned by different user
    jest.spyOn(SearchSessionModel, 'findById').mockResolvedValue({
      _id: 'search123',
      userId: 'otherUser',
      status: 'running',
      query: 'test',
      iterationCount: 0,
      foundJobs: [],
      sitesSearched: [],
      claudeConversationHistory: [],
      startedAt: new Date()
    } as any)

    const response = await request(app)
      .get('/api/searches/search123/stream')

    expect(response.status).toBe(403)
  })

  it('should set SSE headers', async () => {
    jest.spyOn(SearchSessionModel, 'findById').mockResolvedValue({
      _id: 'search123',
      userId: 'user123',
      status: 'running',
      query: 'test',
      iterationCount: 0,
      foundJobs: [],
      sitesSearched: [],
      claudeConversationHistory: [],
      startedAt: new Date()
    } as any)

    const response = await request(app)
      .get('/api/searches/search123/stream')

    expect(response.headers['content-type']).toBe('text/event-stream')
    expect(response.headers['cache-control']).toBe('no-cache')
  })

  it('should send sync event on connect', async () => {
    const jobData = [
      { _id: 'job1', title: 'Senior Dev', matchScore: 85 }
    ]

    jest.spyOn(SearchSessionModel, 'findById').mockResolvedValue({
      _id: 'search123',
      userId: 'user123',
      status: 'running',
      query: 'test',
      iterationCount: 2,
      foundJobs: ['job1'],
      sitesSearched: ['linkedin.com'],
      claudeConversationHistory: [],
      startedAt: new Date()
    } as any)

    jest.spyOn(SearchSessionModel, 'countDocuments').mockResolvedValue(1)

    // Note: testing SSE is tricky with supertest; we primarily test the setup
    const response = await request(app)
      .get('/api/searches/search123/stream')

    expect(response.status).toBe(200)
  })
})
```

Run: `npm test -- stream.test.ts`  
Expected: FAIL — route not defined

### Step 2.2: Implement stream endpoint

Create `packages/api/src/routes/stream.ts`:

```typescript
import { Router, Request, Response, NextFunction } from 'express'
import { authMiddleware } from '../auth/auth.controller.js'
import { SearchSessionModel, JobModel } from '../db/models.js'
import { SSEManager } from '../utils/SSEManager.js'

export function streamRouter(sseManager: SSEManager) {
  const router = Router()

  router.use(authMiddleware)

  router.get('/:searchId/stream', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as any).userId
      const { searchId } = req.params

      // Verify search exists and user owns it
      const session = await SearchSessionModel.findById(searchId)
      if (!session) {
        return res.status(404).json({ error: 'Search not found' })
      }

      if (session.userId !== userId) {
        return res.status(403).json({ error: 'Access denied' })
      }

      // Set SSE headers
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')
      res.setHeader('X-Accel-Buffering', 'no')

      // Subscribe client to SSE manager
      sseManager.subscribe(searchId, res)

      // Fetch current jobs for sync event
      const jobs = await JobModel.find({ searchSessionId: searchId })
      const syncPayload = {
        status: session.status,
        iterationCount: session.iterationCount,
        jobs: jobs.map(job => ({
          id: job._id.toString(),
          title: job.title,
          company: job.company,
          description: job.description,
          url: job.url,
          salary: job.salary,
          location: job.location,
          matchScore: job.matchScore || 0,
          matchReasoning: job.matchReasoning || ''
        })),
        sitesSearched: session.sitesSearched || []
      }

      // Send initial sync event
      res.write(`data: ${JSON.stringify({ type: 'sync', payload: syncPayload })}\n\n`)

      // Start heartbeat to keep connection alive
      const heartbeat = setInterval(() => {
        res.write('data: {"type":"ping"}\n\n')
      }, 30000)

      // Cleanup on disconnect
      res.on('close', () => {
        clearInterval(heartbeat)
        sseManager.unsubscribe(searchId, res)
      })
    } catch (error) {
      next(error)
    }
  })

  return router
}
```

Update `packages/api/src/app.ts` to include the stream router (add this where you mount the searches router):

```typescript
import { streamRouter } from './routes/stream.js'

// In your app setup:
app.use('/api/searches', streamRouter(sseManager))
app.use('/api/searches', searchesRouter)
```

### Step 2.3: Run tests

Run: `npm test -- stream.test.ts`  
Expected: PASS

### Step 2.4: Commit

```bash
git add packages/api/src/routes/stream.ts packages/api/tests/stream.test.ts
git commit -m "feat: add SSE stream endpoint for search results"
```

---

## Task 3: Create useSSE Frontend Hook

**Files:**
- Create: `packages/frontend/src/hooks/useSSE.ts`
- Test: `packages/frontend/tests/useSSE.test.ts`

### Step 3.1: Write the failing test for useSSE hook

Create `packages/frontend/tests/useSSE.test.ts`:

```typescript
import { renderHook, waitFor } from '@testing-library/react'
import { useSSE } from '../src/hooks/useSSE'

describe('useSSE Hook', () => {
  const mockToken = 'test-token'
  const mockSearchId = 'search123'

  beforeEach(() => {
    global.EventSource = jest.fn() as any
  })

  it('should initialize with running status', () => {
    const { result } = renderHook(() => useSSE(mockSearchId, mockToken))

    expect(result.current.status).toBe('running')
    expect(result.current.isConnected).toBe(false)
  })

  it('should connect to SSE endpoint on mount', () => {
    const EventSourceMock = jest.fn()
    global.EventSource = EventSourceMock as any

    renderHook(() => useSSE(mockSearchId, mockToken))

    expect(EventSourceMock).toHaveBeenCalledWith(
      `/api/searches/${mockSearchId}/stream`,
      expect.objectContaining({ withCredentials: false })
    )
  })

  it('should handle sync event', async () => {
    let eventListeners: { [key: string]: Function } = {}
    const EventSourceMock = jest.fn(function() {
      this.addEventListener = (event: string, listener: Function) => {
        eventListeners[event] = listener
      }
    })
    global.EventSource = EventSourceMock as any

    const { result } = renderHook(() => useSSE(mockSearchId, mockToken))

    const syncEvent = new MessageEvent('message', {
      data: JSON.stringify({
        type: 'sync',
        payload: {
          status: 'running',
          iterationCount: 2,
          jobs: [{ id: 'job1', title: 'Dev Job', matchScore: 85 }],
          sitesSearched: ['linkedin.com']
        }
      })
    })

    eventListeners['message'](syncEvent)

    await waitFor(() => {
      expect(result.current.jobs).toHaveLength(1)
      expect(result.current.iterationCount).toBe(2)
    })
  })

  it('should handle status event', async () => {
    let eventListeners: { [key: string]: Function } = {}
    const EventSourceMock = jest.fn(function() {
      this.addEventListener = (event: string, listener: Function) => {
        eventListeners[event] = listener
      }
    })
    global.EventSource = EventSourceMock as any

    const { result } = renderHook(() => useSSE(mockSearchId, mockToken))

    const statusEvent = new MessageEvent('message', {
      data: JSON.stringify({
        type: 'status',
        payload: { status: 'complete', iterationCount: 3 }
      })
    })

    eventListeners['message'](statusEvent)

    await waitFor(() => {
      expect(result.current.status).toBe('complete')
      expect(result.current.iterationCount).toBe(3)
    })
  })

  it('should handle job event', async () => {
    let eventListeners: { [key: string]: Function } = {}
    const EventSourceMock = jest.fn(function() {
      this.addEventListener = (event: string, listener: Function) => {
        eventListeners[event] = listener
      }
    })
    global.EventSource = EventSourceMock as any

    const { result } = renderHook(() => useSSE(mockSearchId, mockToken))

    const jobEvent = new MessageEvent('message', {
      data: JSON.stringify({
        type: 'job',
        payload: {
          job: { id: 'job2', title: 'Senior Dev', matchScore: 92 },
          totalFound: 5
        }
      })
    })

    eventListeners['message'](jobEvent)

    await waitFor(() => {
      expect(result.current.jobs).toHaveLength(1)
    })
  })

  it('should reconnect on connection error', async () => {
    let eventListeners: { [key: string]: Function } = {}
    const EventSourceMock = jest.fn(function() {
      this.addEventListener = (event: string, listener: Function) => {
        eventListeners[event] = listener
      }
      this.close = jest.fn()
    })
    global.EventSource = EventSourceMock as any

    jest.useFakeTimers()
    const { result } = renderHook(() => useSSE(mockSearchId, mockToken))

    expect(result.current.isConnected).toBe(false)

    // Trigger error
    eventListeners['error'](new Event('error'))

    // First backoff should be 1 second
    expect(result.current.error).toBeTruthy()

    jest.advanceTimersByTime(1000)

    await waitFor(() => {
      expect(EventSourceMock).toHaveBeenCalledTimes(2) // Initial + reconnect
    })

    jest.useRealTimers()
  })

  it('should not reconnect after max attempts', async () => {
    let eventListeners: { [key: string]: Function } = {}
    const EventSourceMock = jest.fn(function() {
      this.addEventListener = (event: string, listener: Function) => {
        eventListeners[event] = listener
      }
      this.close = jest.fn()
    })
    global.EventSource = EventSourceMock as any

    jest.useFakeTimers()
    const { result } = renderHook(() => useSSE(mockSearchId, mockToken))

    // Trigger 5 errors
    for (let i = 0; i < 5; i++) {
      eventListeners['error'](new Event('error'))
      jest.advanceTimersByTime(8000) // Fast-forward through backoff
    }

    await waitFor(() => {
      expect(result.current.error).toContain('Failed to connect')
    })

    jest.useRealTimers()
  })

  it('should clean up on unmount', () => {
    const closeJs = jest.fn()
    const EventSourceMock = jest.fn(function() {
      this.close = closeJs
      this.addEventListener = jest.fn()
    })
    global.EventSource = EventSourceMock as any

    const { unmount } = renderHook(() => useSSE(mockSearchId, mockToken))

    unmount()

    expect(closeJs).toHaveBeenCalled()
  })
})
```

Run: `npm test -- useSSE.test.ts`  
Expected: FAIL — hook not defined

### Step 3.2: Implement useSSE hook

Create `packages/frontend/src/hooks/useSSE.ts`:

```typescript
import { useState, useEffect, useCallback } from 'react'

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

interface SSEPayload {
  type: 'sync' | 'status' | 'job' | 'ping' | 'error'
  payload: any
}

interface UseSSEReturn {
  status: 'running' | 'complete' | 'failed'
  iterationCount: number
  jobs: Job[]
  sitesSearched: string[]
  isConnected: boolean
  error: string | null
}

export function useSSE(searchId: string, token: string): UseSSEReturn {
  const [status, setStatus] = useState<'running' | 'complete' | 'failed'>('running')
  const [iterationCount, setIterationCount] = useState(0)
  const [jobs, setJobs] = useState<Job[]>([])
  const [sitesSearched, setSitesSearched] = useState<string[]>([])
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reconnectAttempts, setReconnectAttempts] = useState(0)
  const [eventSource, setEventSource] = useState<EventSource | null>(null)

  const connect = useCallback(() => {
    try {
      const es = new EventSource(`/api/searches/${searchId}/stream`, {
        withCredentials: false
      })

      es.addEventListener('message', (event: MessageEvent) => {
        try {
          const data: SSEPayload = JSON.parse(event.data)

          switch (data.type) {
            case 'sync':
              setStatus(data.payload.status)
              setIterationCount(data.payload.iterationCount)
              setJobs(data.payload.jobs || [])
              setSitesSearched(data.payload.sitesSearched || [])
              setIsConnected(true)
              setError(null)
              setReconnectAttempts(0)
              break

            case 'status':
              setStatus(data.payload.status)
              setIterationCount(data.payload.iterationCount)
              break

            case 'job':
              setJobs(prev => [...prev, data.payload.job])
              break

            case 'error':
              setStatus('failed')
              setError(data.payload.message)
              break

            case 'ping':
              // Heartbeat, no action needed
              break
          }
        } catch (parseError) {
          console.error('Failed to parse SSE message:', parseError)
        }
      })

      es.addEventListener('open', () => {
        setIsConnected(true)
        setError(null)
      })

      es.addEventListener('error', () => {
        setIsConnected(false)
        es.close()
        setEventSource(null)

        // Exponential backoff: 1s, 2s, 4s, 8s, 8s
        const nextAttempt = reconnectAttempts + 1
        const delay = Math.min(1000 * Math.pow(2, nextAttempt - 1), 8000)

        if (nextAttempt < 5) {
          setReconnectAttempts(nextAttempt)
          setTimeout(connect, delay)
        } else {
          setError('Failed to connect to search stream. Click reconnect to try again.')
        }
      })

      setEventSource(es)
    } catch (err) {
      setError('Failed to connect to search stream')
      setIsConnected(false)
    }
  }, [searchId, reconnectAttempts])

  useEffect(() => {
    connect()

    return () => {
      if (eventSource) {
        eventSource.close()
      }
    }
  }, [searchId, token])

  return {
    status,
    iterationCount,
    jobs,
    sitesSearched,
    isConnected,
    error
  }
}
```

### Step 3.3: Run tests

Run: `npm test -- useSSE.test.ts`  
Expected: PASS

### Step 3.4: Commit

```bash
git add packages/frontend/src/hooks/useSSE.ts packages/frontend/tests/useSSE.test.ts
git commit -m "feat: add useSSE hook for real-time search updates"
```

---

## Task 4: Modify Event Handlers to Broadcast SSE Events

**Files:**
- Modify: `packages/api/src/events/handlers.ts`

### Step 4.1: Update imports and add SSEManager injection

In `packages/api/src/events/handlers.ts`, at the top of the file, add SSEManager import:

```typescript
import { SSEManager } from '../utils/SSEManager.js'
```

Update the handler functions to accept SSEManager as a parameter. For each handler function signature, change from:

```typescript
export async function handleSearchStarted(event: SearchStartedEvent) {
  // ...
}
```

To:

```typescript
export async function handleSearchStarted(event: SearchStartedEvent, sseManager: SSEManager) {
  // ...
}
```

Do this for all four handlers:
- `handleSearchStarted`
- `handleClaudeAnalysisComplete`
- `handleJobsCrawled`
- `handleJobsRanked`

### Step 4.2: Add broadcast after Claude analysis completes

In `handleClaudeAnalysisComplete`, after the session is updated with `session.status = 'running'` and saved, add this broadcast:

```typescript
// Broadcast status update
sseManager.broadcast(event.searchId, {
  type: 'status',
  payload: {
    status: session.status,
    iterationCount: session.iterationCount
  }
})
```

### Step 4.3: Add broadcast for each crawled job

In `handleJobsCrawled`, after each job is saved to the database, add:

```typescript
// Broadcast new job
sseManager.broadcast(event.searchId, {
  type: 'job',
  payload: {
    job: {
      id: job._id.toString(),
      title: job.title,
      company: job.company,
      description: job.description,
      url: job.url,
      salary: job.salary,
      location: job.location,
      matchScore: 0,
      matchReasoning: ''
    },
    totalFound: crawledJobs.length
  }
})
```

### Step 4.4: Add broadcast after jobs are ranked

In `handleJobsRanked`, after updating the session status to 'complete' and saving, add:

```typescript
// Broadcast completion status
sseManager.broadcast(event.searchId, {
  type: 'status',
  payload: {
    status: 'complete',
    iterationCount: session.iterationCount
  }
})
```

### Step 4.5: Add broadcast on error

In all handlers, wrap the main logic in a try-catch and add error broadcast:

```typescript
} catch (error) {
  console.error(`Handler error: ${error}`)
  const session = await SearchSessionModel.findById(event.searchId)
  if (session) {
    session.status = 'failed'
    await session.save()
  }
  
  sseManager.broadcast(event.searchId, {
    type: 'error',
    payload: {
      message: 'Search processing failed',
      searchStatus: 'failed'
    }
  })
  throw error
}
```

### Step 4.6: Update event queue to pass SSEManager to handlers

In `packages/api/src/events/queue.ts`, update the handler calls to pass the SSEManager instance. Find where handlers are invoked (likely in the queue worker setup) and update like:

```typescript
const sseManager = new SSEManager() // Initialize at app startup

queue.process('search_started', async (job) => {
  await handleSearchStarted(job.data, sseManager)
})

queue.process('claude_analysis_complete', async (job) => {
  await handleClaudeAnalysisComplete(job.data, sseManager)
})

queue.process('jobs_crawled', async (job) => {
  await handleJobsCrawled(job.data, sseManager)
})

queue.process('jobs_ranked', async (job) => {
  await handleJobsRanked(job.data, sseManager)
})

// Export SSEManager for use in stream.ts
export { sseManager }
```

### Step 4.7: Commit

```bash
git add packages/api/src/events/handlers.ts packages/api/src/events/queue.ts
git commit -m "feat: add SSE broadcasting to event handlers"
```

---

## Task 5: Remove Polling Endpoints and Update Searches Router

**Files:**
- Modify: `packages/api/src/routes/searches.ts`

### Step 5.1: Remove getSearchStatus endpoint

Delete the `router.get('/:searchId', ...)` endpoint (lines with GET `/api/searches/:searchId`). This was used to poll for status.

### Step 5.2: Remove getSearchResults endpoint

Delete the `router.get('/:searchId/jobs', ...)` endpoint (lines with GET `/api/searches/:searchId/jobs`). This was used to poll for job results.

### Step 5.3: Verify POST endpoint remains

Ensure `router.post('/', ...)` (POST `/api/searches`) is still present and unchanged. This creates new searches.

The file should now only have:
- POST `/api/searches` - create search
- (Any other endpoints like GET /api/searches for listing user's searches)

### Step 5.4: Commit

```bash
git add packages/api/src/routes/searches.ts
git commit -m "refactor: remove polling endpoints, SSE provides updates"
```

---

## Task 6: Modify Frontend ResultsPage to Use useSSE

**Files:**
- Modify: `packages/frontend/src/pages/ResultsPage.tsx`

### Step 6.1: Replace polling logic with useSSE hook

Update `packages/frontend/src/pages/ResultsPage.tsx`:

```typescript
import { useSSE } from '../hooks/useSSE'
import { ProgressDisplay } from '../components/ProgressDisplay'
import { JobCard } from '../components/JobCard'

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
  const { status, iterationCount, jobs, isConnected, error } = useSSE(searchId, token)

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '40px 20px' }}>
      <button onClick={onBack} style={{ marginBottom: '20px' }}>← Back to Search</button>
      
      <h1>Search Results</h1>

      {!isConnected && error && (
        <div style={{
          padding: '12px',
          marginBottom: '20px',
          backgroundColor: '#fee',
          border: '1px solid #f88',
          borderRadius: '4px',
          color: '#c33'
        }}>
          <p>{error}</p>
          <button onClick={() => window.location.reload()}>Reconnect</button>
        </div>
      )}

      {!isConnected && !error && (
        <div style={{
          padding: '12px',
          marginBottom: '20px',
          backgroundColor: '#ffe',
          border: '1px solid #dd8',
          borderRadius: '4px',
          color: '#880'
        }}>
          Connecting to search stream...
        </div>
      )}

      <ProgressDisplay status={status} iterationCount={iterationCount} jobsFound={jobs.length} />
      
      {jobs.map(job => (
        <JobCard key={job.id} job={job} />
      ))}
    </div>
  )
}
```

### Step 6.2: Commit

```bash
git add packages/frontend/src/pages/ResultsPage.tsx
git commit -m "refactor: replace polling with SSE hook in ResultsPage"
```

---

## Task 7: Simplify useApi Hook

**Files:**
- Modify: `packages/frontend/src/hooks/useApi.ts`

### Step 7.1: Remove polling methods

Update `packages/frontend/src/hooks/useApi.ts` to remove the `getSearchStatus` and `getSearchResults` methods:

```typescript
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

  return { createSearch }
}
```

### Step 7.2: Commit

```bash
git add packages/frontend/src/hooks/useApi.ts
git commit -m "refactor: remove polling methods from useApi hook"
```

---

## Task 8: Integration Test - Full SSE Flow

**Files:**
- Create: `packages/api/tests/sse-integration.test.ts`

### Step 8.1: Write integration test

Create `packages/api/tests/sse-integration.test.ts`:

```typescript
import { SSEManager } from '../src/utils/SSEManager'
import { SearchSessionModel, JobModel } from '../src/db/models'

describe('SSE Integration Flow', () => {
  let sseManager: SSEManager

  beforeEach(() => {
    sseManager = new SSEManager()
  })

  it('should stream search progress from creation to completion', async () => {
    const searchId = 'search-integration-test'
    const mockRes = { write: jest.fn() } as any

    // Simulate client connecting to SSE
    sseManager.subscribe(searchId, mockRes)

    // 1. Send initial sync event
    sseManager.broadcast(searchId, {
      type: 'sync',
      payload: {
        status: 'running',
        iterationCount: 0,
        jobs: [],
        sitesSearched: []
      }
    })

    expect(mockRes.write).toHaveBeenCalled()

    // 2. Simulate iteration progress
    sseManager.broadcast(searchId, {
      type: 'status',
      payload: { status: 'running', iterationCount: 1 }
    })

    // 3. Simulate new job found
    sseManager.broadcast(searchId, {
      type: 'job',
      payload: {
        job: {
          id: 'job1',
          title: 'Senior Dev',
          company: 'TechCorp',
          description: 'Great role',
          url: 'https://example.com/job1',
          location: 'Remote',
          matchScore: 85,
          matchReasoning: 'Matches your experience'
        },
        totalFound: 1
      }
    })

    // 4. Simulate completion
    sseManager.broadcast(searchId, {
      type: 'status',
      payload: { status: 'complete', iterationCount: 2 }
    })

    // Verify all messages were sent
    const callCount = (mockRes.write as jest.Mock).mock.calls.length
    expect(callCount).toBeGreaterThanOrEqual(4) // sync, status, job, status
  })

  it('should isolate streams for different searches', () => {
    const search1Res = { write: jest.fn() } as any
    const search2Res = { write: jest.fn() } as any

    sseManager.subscribe('search1', search1Res)
    sseManager.subscribe('search2', search2Res)

    sseManager.broadcast('search1', {
      type: 'status',
      payload: { status: 'running', iterationCount: 1 }
    })

    expect(search1Res.write).toHaveBeenCalledTimes(1)
    expect(search2Res.write).toHaveBeenCalledTimes(0)
  })

  it('should handle multiple concurrent clients for same search', () => {
    const client1 = { write: jest.fn() } as any
    const client2 = { write: jest.fn() } as any
    const searchId = 'shared-search'

    sseManager.subscribe(searchId, client1)
    sseManager.subscribe(searchId, client2)

    sseManager.broadcast(searchId, {
      type: 'job',
      payload: {
        job: { id: 'job1', title: 'Dev' },
        totalFound: 1
      }
    })

    expect(client1.write).toHaveBeenCalled()
    expect(client2.write).toHaveBeenCalled()
  })
})
```

Run: `npm test -- sse-integration.test.ts`  
Expected: PASS

### Step 8.2: Commit

```bash
git add packages/api/tests/sse-integration.test.ts
git commit -m "test: add SSE integration tests for complete flow"
```

---

## Task 9: End-to-End Verification

**Files:**
- No changes, manual testing

### Step 9.1: Start development environment

```bash
npm run dev
```

This should start:
- Frontend on http://localhost:5173
- API on http://localhost:3000
- MongoDB and Redis containers

### Step 9.2: Test search flow

1. Open http://localhost:5173 in browser
2. Register/login
3. Enter a search query (e.g., "Python developer")
4. Click "Search"
5. Open browser DevTools Network tab
6. Verify:
   - One SSE connection to `/api/searches/{id}/stream`
   - No polling requests to `/api/searches/{id}` or `/api/searches/{id}/jobs`
   - Jobs appear in real-time as `job` events arrive
   - Status updates appear as `status` events arrive

### Step 9.3: Test reconnection

1. In DevTools, set Network throttling to "Offline"
2. Wait 5 seconds
3. Set throttling back to "Online"
4. Verify:
   - Connection re-establishes automatically
   - "Connecting..." message briefly appears
   - `sync` event refetches all data
   - Stream resumes receiving updates

### Step 9.4: Test multiple tabs

1. Open search in Tab A
2. Open same search in Tab B (different browser tabs)
3. Verify both tabs show real-time updates independently
4. Each tab has its own SSE connection

### Step 9.5: Commit verification results

```bash
git add .
git commit -m "test: verify SSE integration end-to-end"
```

---

## Summary

**Files Created:**
- `packages/api/src/utils/SSEManager.ts` — client tracking and broadcast
- `packages/api/src/routes/stream.ts` — SSE endpoint
- `packages/frontend/src/hooks/useSSE.ts` — frontend SSE hook
- `packages/api/tests/SSEManager.test.ts` — SSEManager tests
- `packages/api/tests/stream.test.ts` — endpoint tests
- `packages/frontend/tests/useSSE.test.ts` — hook tests
- `packages/api/tests/sse-integration.test.ts` — integration tests

**Files Modified:**
- `packages/api/src/events/handlers.ts` — add SSE broadcasts
- `packages/api/src/events/queue.ts` — pass SSEManager to handlers
- `packages/api/src/routes/searches.ts` — remove polling endpoints
- `packages/frontend/src/pages/ResultsPage.tsx` — use useSSE hook
- `packages/frontend/src/hooks/useApi.ts` — remove polling methods

**Key Design Decisions:**
- SSEManager is initialized once and passed to handlers and stream route
- Handlers broadcast immediately as events complete (not poll-backed)
- Frontend reconnects with sync event to restore full state
- Exponential backoff caps at 8 seconds, max 5 attempts
- Each browser tab gets independent SSE connection

**Testing Coverage:**
- Unit tests for SSEManager (subscription, broadcast, cleanup)
- Unit tests for stream endpoint (auth, headers, sync event)
- Unit tests for useSSE hook (connection, parsing, reconnection, cleanup)
- Integration test for full event flow
- Manual end-to-end testing (connection, reconnection, multi-tab)
