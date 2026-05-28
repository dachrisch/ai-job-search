import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { Request, Response, NextFunction } from 'express'
import { handleStreamConnect } from '../src/routes/stream'
import { SSEManager } from '../src/utils/SSEManager'
import { SearchSessionModel, JobModel } from '../src/db/models'

describe('Stream Endpoint', () => {
  let manager: SSEManager

  beforeEach(() => {
    manager = new SSEManager()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should return 404 if search not found', async () => {
    vi.spyOn(SearchSessionModel, 'findById').mockResolvedValue(null)

    const req = {
      params: { searchId: 'invalid' },
      headers: { authorization: 'Bearer token' },
      userId: 'user123'
    } as any as Request
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      setHeader: vi.fn(),
      write: vi.fn(),
      on: vi.fn(),
      once: vi.fn()
    } as any as Response
    const next = vi.fn()

    ;(req as any).userId = 'user123'

    await handleStreamConnect(req, res, next, manager)

    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith({ error: 'Search not found' })
  })

  it('should return 403 if user does not own search', async () => {
    vi.spyOn(SearchSessionModel, 'findById').mockResolvedValue({
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

    const req = {
      params: { searchId: 'search123' },
      headers: { authorization: 'Bearer token' }
    } as any as Request
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      setHeader: vi.fn(),
      write: vi.fn(),
      on: vi.fn(),
      once: vi.fn()
    } as any as Response
    const next = vi.fn()

    ;(req as any).userId = 'user123'

    await handleStreamConnect(req, res, next, manager)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ error: 'Access denied' })
  })

  it('should set SSE headers on successful connection', async () => {
    vi.spyOn(SearchSessionModel, 'findById').mockResolvedValue({
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

    vi.spyOn(JobModel, 'find').mockResolvedValue([])

    const req = {
      params: { searchId: 'search123' },
      headers: { authorization: 'Bearer token' }
    } as any as Request
    const res = {
      setHeader: vi.fn(),
      write: vi.fn(),
      on: vi.fn(),
      once: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis()
    } as any as Response
    const next = vi.fn()

    ;(req as any).userId = 'user123'

    await handleStreamConnect(req, res, next, manager)

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream')
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache')
    expect(res.setHeader).toHaveBeenCalledWith('Connection', 'keep-alive')
    expect(res.setHeader).toHaveBeenCalledWith('X-Accel-Buffering', 'no')
  })

  it('should send sync event on connect', async () => {
    vi.spyOn(SearchSessionModel, 'findById').mockResolvedValue({
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

    vi.spyOn(JobModel, 'find').mockResolvedValue([
      {
        _id: { toString: () => 'job1' },
        title: 'Senior Dev',
        company: 'Tech Inc',
        description: 'Desc',
        url: 'http://example.com',
        salary: '100k',
        location: 'Remote',
        matchScore: 85,
        matchReasoning: 'Good match'
      }
    ] as any)

    const req = {
      params: { searchId: 'search123' },
      headers: { authorization: 'Bearer token' }
    } as any as Request
    const res = {
      setHeader: vi.fn(),
      write: vi.fn(),
      on: vi.fn(),
      once: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis()
    } as any as Response
    const next = vi.fn()

    ;(req as any).userId = 'user123'

    await handleStreamConnect(req, res, next, manager)

    expect(res.write).toHaveBeenCalled()
    const writeCalls = (res.write as any).mock.calls
    const syncEventCall = writeCalls.find((call: any[]) => call[0]?.includes('sync'))
    expect(syncEventCall).toBeDefined()
  })

  it('should subscribe client to SSE manager', async () => {
    vi.spyOn(SearchSessionModel, 'findById').mockResolvedValue({
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

    vi.spyOn(JobModel, 'find').mockResolvedValue([])

    const subscribeSpy = vi.spyOn(manager, 'subscribe')

    const req = {
      params: { searchId: 'search123' },
      headers: { authorization: 'Bearer token' }
    } as any as Request
    const res = {
      setHeader: vi.fn(),
      write: vi.fn(),
      on: vi.fn(),
      once: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis()
    } as any as Response
    const next = vi.fn()

    ;(req as any).userId = 'user123'

    await handleStreamConnect(req, res, next, manager)

    expect(subscribeSpy).toHaveBeenCalledWith('search123', res)
  })
})
