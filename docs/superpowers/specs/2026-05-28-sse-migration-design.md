# Server-Sent Events (SSE) Migration Design

**Date:** 2026-05-28  
**Status:** In Review  
**Scope:** Replace polling-based real-time updates with event-driven SSE

## Problem Statement

Current implementation polls the API every 2 seconds for search status and job updates. This approach:
- Generates unnecessary HTTP requests even when no updates occur
- Adds 2-second latency before frontend sees new results
- Wastes bandwidth and server resources
- Doesn't scale well with concurrent users

## Solution Overview

Migrate to Server-Sent Events (SSE) where the backend actively pushes updates to connected clients as they occur. Event handlers broadcast status changes and new jobs in real-time.

## Architecture

### Backend Architecture

#### SSEManager (`src/utils/SSEManager.ts`)
Manages active SSE client connections per search session.

```typescript
class SSEManager {
  private clients: Map<searchId, Set<Response>>
  
  subscribe(searchId: string, res: Response)
  unsubscribe(searchId: string, res: Response)
  broadcast(searchId: string, event: SSEEvent)
}
```

**Responsibilities:**
- Track all connected clients for each search
- Clean up disconnected clients automatically
- Broadcast messages to all clients watching a search

#### SSE Endpoint (`src/routes/stream.ts` → `GET /api/searches/:searchId/stream`)

New endpoint that:
1. Authenticates user
2. Verifies user owns the search
3. Registers client with SSEManager
4. Returns Server-Sent Events stream
5. Sends initial `sync` event with current state
6. Keeps connection open for incoming events

#### Event Handlers Modified (`src/events/handlers.ts`)

Each handler (claude_analysis_complete, jobs_crawled, jobs_ranked) will:
1. Perform existing logic (update database, emit next event)
2. Call `SSEManager.broadcast()` to notify connected clients
3. Message includes updated status, new jobs, or iteration count

**Handler broadcast points:**
- `claude_analysis_complete`: broadcast status update
- `jobs_crawled`: broadcast each new job found
- `jobs_ranked`: broadcast job with match score and reasoning
- `search_failed`: broadcast failure status

#### API Changes (`src/routes/searches.ts`)

**Removed endpoints:**
- `GET /api/searches/:searchId` (status polling)
- `GET /api/searches/:searchId/jobs` (results polling)

**Kept endpoints:**
- `POST /api/searches` (create search) — unchanged
- `GET /api/searches` (list searches) — if it exists

**Rationale:** No polling needed with SSE; sync event on connection provides initial state.

### Frontend Architecture

#### useSSE Hook (`src/hooks/useSSE.ts`)

Custom hook managing SSE lifecycle and state recovery.

```typescript
interface SSEEvent {
  type: 'sync' | 'status' | 'job' | 'ping'
  payload: any
}

function useSSE(searchId: string, token: string) {
  // Returns: { status, iterationCount, jobs, error, isConnected }
  // Handles: connection, reconnection, message parsing, state sync
}
```

**Features:**
- Auto-connects on mount
- Auto-reconnects on disconnect with exponential backoff
- Refetches full state on reconnect (via sync event)
- Parses incoming SSE events
- Updates React state on each message
- Cleans up connection on unmount

**Reconnection strategy:**
- Initial backoff: 1s
- Backoff increases: 2s, 4s, 8s, 8s (capped)
- Max attempts: 5
- After max attempts: show reconnect button
- Non-retryable errors (404, 403): no reconnect, show error

#### ResultsPage Refactor (`src/pages/ResultsPage.tsx`)

Replace polling logic with SSE hook:

```typescript
export function ResultsPage({ searchId, token, onBack }) {
  const { status, iterationCount, jobs, error, isConnected } = useSSE(searchId, token)
  
  // Show connection status indicator if needed
  // Render status, jobs as before
  // Show error with "Reconnect" button if connection fails
}
```

#### API Hook Simplification (`src/hooks/useApi.ts`)

Remove polling methods:
- ~~`getSearchStatus`~~
- ~~`getSearchResults`~~

Keep:
- `createSearch` (unchanged)

## Message Format (SSE Events)

### Event: `sync` (on connection)
Sent immediately when client connects. Contains current complete state.

```json
{
  "type": "sync",
  "payload": {
    "status": "running",
    "iterationCount": 2,
    "jobs": [
      {
        "id": "...",
        "title": "...",
        "company": "...",
        "description": "...",
        "url": "...",
        "salary": "...",
        "location": "...",
        "matchScore": 85,
        "matchReasoning": "..."
      }
    ],
    "sitesSearched": ["linkedin.com", "indeed.com"]
  }
}
```

### Event: `status`
Emitted when search status or iteration count changes.

```json
{
  "type": "status",
  "payload": {
    "status": "running",
    "iterationCount": 3
  }
}
```

### Event: `job`
Emitted when a new ranked job becomes available.

```json
{
  "type": "job",
  "payload": {
    "job": {
      "id": "...",
      "title": "...",
      "company": "...",
      "description": "...",
      "url": "...",
      "salary": "...",
      "location": "...",
      "matchScore": 92,
      "matchReasoning": "..."
    },
    "totalFound": 15
  }
}
```

### Event: `ping`
Heartbeat to keep connection alive (server sends every 30s if no other events).

```json
{
  "type": "ping"
}
```

### Event: `error` (optional)
Sent if server-side error occurs during processing.

```json
{
  "type": "error",
  "payload": {
    "message": "Crawler service unavailable",
    "searchStatus": "failed"
  }
}
```

## Error Handling & Recovery

### Connection Failures
- Network disconnect: auto-reconnect with exponential backoff
- 404 Not Found: search was deleted, show error (no retry)
- 403 Forbidden: access revoked, show error (no retry)
- 500 Server Error: retry with backoff

### State Recovery
On reconnect:
1. Client reconnects to SSE endpoint
2. Server sends new `sync` event with current DB state
3. Client applies sync (overwrites local state with DB truth)
4. Client resumes receiving new events

This ensures consistency even if client misses events during disconnect.

### Reconnection UI
- Show "Connecting..." during reconnect
- Show "Connection failed" after 5 failed attempts
- Provide manual "Reconnect" button
- Show connection indicator (optional: green dot = connected)

## Data Flow

```
┌─────────────────────────────────────────────────┐
│           User creates search                     │
│        POST /api/searches → SearchId              │
└────────────────────┬────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────┐
│     Frontend connects to SSE stream              │
│  GET /api/searches/{id}/stream (EventSource)    │
└────────────────────┬────────────────────────────┘
                     │
                     ▼
        ┌────────────────────────────┐
        │  Server sends sync event    │
        │  (current state snapshot)   │
        └────────────┬────────────────┘
                     │
        ┌────────────┴───────────────────────────┐
        │                                         │
        ▼                                         ▼
┌──────────────────────┐              ┌──────────────────────┐
│  Event Handler:      │              │  Event Handler:      │
│  claude_analysis     │              │  jobs_ranked         │
│  ├─ Process event    │              │  ├─ Update DB        │
│  ├─ Update DB        │              │  ├─ Broadcast job    │
│  └─ Broadcast status │              │  └─ SSE → client     │
└──────────────────────┘              └──────────────────────┘
        │                                         │
        └────────────┬───────────────────────────┘
                     │
                     ▼
        ┌────────────────────────────┐
        │  Frontend receives events   │
        │  Updates local state        │
        │  Re-renders with new data   │
        └────────────────────────────┘
```

## Implementation Files

### New Files
- `packages/api/src/utils/SSEManager.ts` — client tracking and broadcast
- `packages/api/src/routes/stream.ts` — SSE endpoint
- `packages/frontend/src/hooks/useSSE.ts` — frontend SSE management

### Modified Files
- `packages/api/src/events/handlers.ts` — add SSEManager broadcast calls
- `packages/api/src/routes/searches.ts` — remove polling endpoints, add stream route
- `packages/frontend/src/pages/ResultsPage.tsx` — replace polling with useSSE
- `packages/frontend/src/hooks/useApi.ts` — remove polling methods

### Deleted/Removed
- Polling logic from ResultsPage
- `getSearchStatus` and `getSearchResults` from useApi hook

## Testing Strategy

### Unit Tests
- **SSEManager:** verify client registration, broadcast to multiple clients, cleanup on disconnect
- **useSSE hook:** verify connection, event parsing, state updates, reconnection backoff
- **Event handlers:** verify broadcast calls with SSEManager

### Integration Tests
- Full search flow: create search → receive sync → receive status updates → receive jobs → complete
- Reconnection: drop connection mid-stream → reconnect → receive sync → resume

### Manual Testing
- Watch jobs stream in real-time as crawler finds them
- Disconnect browser (DevTools) → verify auto-reconnect and state recovery
- Multiple browser tabs (each gets independent stream)
- Verify no polling requests in Network tab

## Backward Compatibility

**Not maintained.** Old polling endpoints are removed since the system is not yet deployed. If needed in the future, we can add a polling-to-SSE adapter, but it's not necessary now.

## Performance Implications

### Improvements
- Eliminates wasted 2-second polling cycles (potentially 50% reduction in requests)
- Real-time delivery of results (no 2-second latency)
- Better server resource utilization (one persistent connection vs. many short requests)
- Reduced bandwidth usage

### Considerations
- SSE connections hold open TCP sockets (use keep-alives/heartbeat to prevent proxies from closing)
- Memory overhead per connected client is minimal (one Response object per client)
- Scales to hundreds of concurrent searches per instance

## Browser Compatibility

EventSource API supported in all modern browsers (IE not supported, but acceptable for this MVP).

## Future Enhancements

- WebSocket upgrade for bi-directional communication (if needed)
- SSE message batching to reduce overhead with high-frequency updates
- Graceful degradation to polling if EventSource unavailable
- Message compression for large job payloads
