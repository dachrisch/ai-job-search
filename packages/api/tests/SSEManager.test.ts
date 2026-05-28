import { describe, it, expect, beforeEach, vi } from 'vitest'
import { SSEManager } from '../src/utils/SSEManager'
import { Response } from 'express'

describe('SSEManager', () => {
  let manager: SSEManager
  let mockRes: Partial<Response>

  beforeEach(() => {
    manager = new SSEManager()
    mockRes = {
      write: vi.fn(),
      on: vi.fn()
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
    const res1 = { write: vi.fn(), on: vi.fn() } as any
    const res2 = { write: vi.fn(), on: vi.fn() } as any

    manager.subscribe('search123', res1)
    manager.subscribe('search123', res2)

    manager.broadcast('search123', { type: 'status', payload: { status: 'running' } })

    expect(res1.write).toHaveBeenCalled()
    expect(res2.write).toHaveBeenCalled()
  })

  it('should not broadcast to clients of other searches', () => {
    const res1 = { write: vi.fn(), on: vi.fn() } as any
    const res2 = { write: vi.fn(), on: vi.fn() } as any

    manager.subscribe('search123', res1)
    manager.subscribe('search456', res2)

    manager.broadcast('search123', { type: 'status', payload: { status: 'running' } })

    expect(res1.write).toHaveBeenCalled()
    expect(res2.write).not.toHaveBeenCalled()
  })

  it('should format messages as Server-Sent Events', () => {
    const res = { write: vi.fn(), on: vi.fn() } as any
    manager.subscribe('search123', res)

    manager.broadcast('search123', {
      type: 'sync',
      payload: { status: 'running', jobs: [] }
    })

    const written = (res.write as any).mock.calls[0][0]
    expect(written).toContain('data:')
    expect(written).toContain('{"type":"sync"')
  })
})
