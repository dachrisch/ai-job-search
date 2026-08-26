import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sweepStuckSearches, startSweeper } from '../src/events/sweeper'
import { SearchSessionModel } from '../src/db/models'

// Explicit factory (not auto-mock) so SearchSessionModel.find is a stable,
// dedicated mock regardless of what other test files register for db/models.
vi.mock('../src/db/models', () => ({
  SearchSessionModel: {
    find: vi.fn(),
    findById: vi.fn(),
    findByIdAndUpdate: vi.fn(),
    create: vi.fn(),
    findOne: vi.fn(),
    countDocuments: vi.fn(),
  },
}))

describe('sweeper', () => {
  let mockStuckSession: any
  let mockActiveSession: any
  let sseManager: any

  beforeEach(() => {
    vi.resetAllMocks()

    mockStuckSession = {
      _id: { toString: () => 'stuck-1' },
      status: 'running',
      save: vi.fn(),
    }
    mockActiveSession = {
      _id: { toString: () => 'active-1' },
      status: 'running',
      save: vi.fn(),
    }
    sseManager = { broadcast: vi.fn() }
  })

  it('marks running sessions older than the deadline as failed', async () => {
    vi.mocked(SearchSessionModel.find).mockResolvedValue([mockStuckSession] as any)

    const marked = await sweepStuckSearches(sseManager)

    expect(marked).toBe(1)
    expect(SearchSessionModel.find).toHaveBeenCalledWith({
      status: 'running',
      startedAt: { $lt: expect.any(Date) },
    })
    expect(mockStuckSession.status).toBe('failed')
    expect(mockStuckSession.failureReason).toContain('deadline')
    expect(mockStuckSession.save).toHaveBeenCalled()
  })

  it('broadcasts an SSE error for each stuck search', async () => {
    vi.mocked(SearchSessionModel.find).mockResolvedValue([mockStuckSession] as any)

    await sweepStuckSearches(sseManager)

    expect(sseManager.broadcast).toHaveBeenCalledWith('stuck-1', {
      type: 'error',
      payload: { message: expect.stringContaining('deadline'), searchStatus: 'failed' },
    })
    expect(sseManager.broadcast).toHaveBeenCalledWith('stuck-1', {
      type: 'status',
      payload: { status: 'failed' },
    })
  })

  it('survives database errors without throwing', async () => {
    vi.mocked(SearchSessionModel.find).mockRejectedValue(new Error('db down'))

    await expect(sweepStuckSearches(sseManager)).resolves.toBe(0)
  })

  it('startSweeper returns a cancellable interval', () => {
    const interval = startSweeper(null)
    expect(interval).toBeDefined()
    clearInterval(interval)
  })
})