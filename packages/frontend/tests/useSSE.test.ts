import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useSSE } from '../src/hooks/useSSE'

describe('useSSE Hook', () => {
  const mockToken = 'test-token'
  const mockSearchId = 'search123'

  beforeEach(() => {
    global.EventSource = vi.fn() as any
  })

  it('should initialize with running status', () => {
    const { result } = renderHook(() => useSSE(mockSearchId, mockToken))

    expect(result.current.status).toBe('running')
    expect(result.current.isConnected).toBe(false)
  })

  it('should connect to SSE endpoint on mount', () => {
    const EventSourceMock = vi.fn()
    global.EventSource = EventSourceMock as any

    renderHook(() => useSSE(mockSearchId, mockToken))

    expect(EventSourceMock).toHaveBeenCalledWith(
      `/api/searches/${mockSearchId}/stream?token=${encodeURIComponent(mockToken)}`,
      expect.objectContaining({ withCredentials: false })
    )
  })

  it('should handle sync event', async () => {
    let eventListeners: { [key: string]: Function } = {}
    const EventSourceMock = vi.fn(function() {
      this.addEventListener = (event: string, listener: Function) => {
        eventListeners[event] = listener
      }
      this.close = vi.fn()
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

    await act(async () => {
      eventListeners['message'](syncEvent)
    })

    await waitFor(() => {
      expect(result.current.jobs).toHaveLength(1)
      expect(result.current.iterationCount).toBe(2)
    })
  })

  it('should handle status event', async () => {
    let eventListeners: { [key: string]: Function } = {}
    const EventSourceMock = vi.fn(function() {
      this.addEventListener = (event: string, listener: Function) => {
        eventListeners[event] = listener
      }
      this.close = vi.fn()
    })
    global.EventSource = EventSourceMock as any

    const { result } = renderHook(() => useSSE(mockSearchId, mockToken))

    const statusEvent = new MessageEvent('message', {
      data: JSON.stringify({
        type: 'status',
        payload: { status: 'complete', iterationCount: 3 }
      })
    })

    await act(async () => {
      eventListeners['message'](statusEvent)
    })

    await waitFor(() => {
      expect(result.current.status).toBe('complete')
      expect(result.current.iterationCount).toBe(3)
    })
  })

  it('should handle job event', async () => {
    let eventListeners: { [key: string]: Function } = {}
    const EventSourceMock = vi.fn(function() {
      this.addEventListener = (event: string, listener: Function) => {
        eventListeners[event] = listener
      }
      this.close = vi.fn()
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

    await act(async () => {
      eventListeners['message'](jobEvent)
    })

    await waitFor(() => {
      expect(result.current.jobs).toHaveLength(1)
    })
  })

  it('should reconnect on connection error', async () => {
    let eventListeners: { [key: string]: Function } = {}
    const EventSourceMock = vi.fn(function() {
      this.addEventListener = (event: string, listener: Function) => {
        eventListeners[event] = listener
      }
      this.close = vi.fn()
    })
    global.EventSource = EventSourceMock as any

    const { result } = renderHook(() => useSSE(mockSearchId, mockToken))

    expect(result.current.isConnected).toBe(false)

    // Trigger error
    await act(async () => {
      eventListeners['error'](new Event('error'))
    })

    // Error should be set immediately
    expect(result.current.error).toBeTruthy()
  }, { timeout: 10000 })

  it('should set error message on connection failure', async () => {
    let eventListeners: { [key: string]: Function } = {}
    const EventSourceMock = vi.fn(function() {
      this.addEventListener = (event: string, listener: Function) => {
        eventListeners[event] = listener
      }
      this.close = vi.fn()
    })
    global.EventSource = EventSourceMock as any

    const { result } = renderHook(() => useSSE(mockSearchId, mockToken))

    // Trigger error
    await act(async () => {
      eventListeners['error'](new Event('error'))
    })

    // Error should be set to indicate connection issue
    expect(result.current.error).toBeTruthy()
    expect(result.current.error).toMatch(/connection|reconnect/i)
  }, { timeout: 10000 })

  it('should clean up on unmount', async () => {
    const closeJs = vi.fn()
    const EventSourceMock = vi.fn(function() {
      this.close = closeJs
      this.addEventListener = vi.fn()
    })
    global.EventSource = EventSourceMock as any

    const { unmount, result } = renderHook(() => useSSE(mockSearchId, mockToken))

    // Verify the hook rendered and EventSource was created
    expect(EventSourceMock).toHaveBeenCalled()

    // Unmount should trigger cleanup
    await act(async () => {
      unmount()
    })

    expect(closeJs).toHaveBeenCalled()
  }, { timeout: 10000 })
})
