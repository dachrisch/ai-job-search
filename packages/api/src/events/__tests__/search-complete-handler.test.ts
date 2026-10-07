import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../db/models.js', () => ({
  SearchSessionModel: { findById: vi.fn() },
  JobModel: { find: vi.fn(), findByIdAndUpdate: vi.fn(), countDocuments: vi.fn() },
  SiteModel: {},
  CompanyModel: {},
}))
vi.mock('../../events/queue.js', () => ({ addEvent: vi.fn() }))
vi.mock('../../utils/pipeline.js', () => ({ emitPipelineEvent: vi.fn() }))
vi.mock('../../ai/llm.js', () => ({ callLLM: vi.fn(), callLLMJson: vi.fn() }))

let eventHandlers: typeof import('../handlers.js')['eventHandlers']
let SearchSessionModel: typeof import('../../db/models.js')['SearchSessionModel']
let JobModel: typeof import('../../db/models.js')['JobModel']
let callLLMJson: typeof import('../../ai/llm.js')['callLLMJson']

const MOCK_SSE = { broadcast: vi.fn() } as any

function mockSession() {
  return {
    _id: 'sess1',
    userId: 'user1',
    query: 'Product Manager in Munich',
    status: 'running',
    jobsScored: 5,
    completedAt: undefined as Date | undefined,
    conversationHistory: [],
    save: vi.fn(),
  }
}

beforeEach(async () => {
  vi.resetModules()
  ;({ eventHandlers } = await import('../handlers.js'))
  ;({ SearchSessionModel, JobModel } = await import('../../db/models.js'))
  ;({ callLLMJson } = await import('../../ai/llm.js'))
  vi.clearAllMocks()
})

describe('search_complete handler (issue #187)', () => {
  it('completes the search without any LLM call, even if the LLM would hang', async () => {
    const session = mockSession()
    vi.mocked(SearchSessionModel.findById).mockResolvedValue(session as any)
    vi.mocked(JobModel.find).mockResolvedValue([])
    vi.mocked(JobModel.countDocuments).mockResolvedValue(0)
    // Simulate the hung-model pathology from the servyy-test incident:
    // the final ranking call never settles.
    vi.mocked(callLLMJson).mockReturnValue(new Promise(() => {}))

    const outcome = await Promise.race([
      eventHandlers.search_complete({ searchId: 'sess1' }, MOCK_SSE).then(() => 'done'),
      new Promise(resolve => setTimeout(() => resolve('hung'), 2000)),
    ])

    expect(outcome).toBe('done')
    expect(callLLMJson).not.toHaveBeenCalled()
    expect(session.status).toBe('complete')
    expect(session.completedAt).toBeInstanceOf(Date)
    expect(session.save).toHaveBeenCalled()
    expect(MOCK_SSE.broadcast).toHaveBeenCalledWith(
      'sess1',
      expect.objectContaining({ type: 'status', payload: expect.objectContaining({ status: 'complete' }) })
    )
  })

  it('completes scored jobs untouched (per-job scoring is the single rank source)', async () => {
    const session = mockSession()
    vi.mocked(SearchSessionModel.findById).mockResolvedValue(session as any)
    vi.mocked(JobModel.find).mockResolvedValue([])
    vi.mocked(JobModel.countDocuments).mockResolvedValue(3)

    await eventHandlers.search_complete({ searchId: 'sess1' }, MOCK_SSE)

    // No re-ranking: jobsScored only ever grows via jobs_extracted.
    expect(session.jobsScored).toBe(5)
    expect(JobModel.findByIdAndUpdate).not.toHaveBeenCalled()
  })

  it('skips completion for sessions that are no longer running', async () => {
    const session = { ...mockSession(), status: 'failed' }
    vi.mocked(SearchSessionModel.findById).mockResolvedValue(session as any)

    await eventHandlers.search_complete({ searchId: 'sess1' }, MOCK_SSE)

    expect(session.save).not.toHaveBeenCalled()
  })
})
