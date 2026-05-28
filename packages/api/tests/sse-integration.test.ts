import { describe, it, expect, beforeEach, vi } from 'vitest'
import { SSEManager } from '../src/utils/SSEManager'

describe('SSE Integration Flow', () => {
  let sseManager: SSEManager

  beforeEach(() => {
    sseManager = new SSEManager()
  })

  it('should stream search progress from creation to completion', async () => {
    const searchId = 'search-integration-test'
    const mockRes = {
      write: vi.fn(),
      on: vi.fn(),
      once: vi.fn()
    } as any

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
    const firstCallCount = (mockRes.write as any).mock.calls.length

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
    const callCount = (mockRes.write as any).mock.calls.length
    expect(callCount).toBeGreaterThanOrEqual(4) // sync, status, job, status
  })

  it('should isolate streams for different searches', () => {
    const search1Res = {
      write: vi.fn(),
      on: vi.fn(),
      once: vi.fn()
    } as any
    const search2Res = {
      write: vi.fn(),
      on: vi.fn(),
      once: vi.fn()
    } as any

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
    const client1 = {
      write: vi.fn(),
      on: vi.fn(),
      once: vi.fn()
    } as any
    const client2 = {
      write: vi.fn(),
      on: vi.fn(),
      once: vi.fn()
    } as any
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
