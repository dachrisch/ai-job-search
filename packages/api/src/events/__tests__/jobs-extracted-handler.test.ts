import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../db/models.js', () => ({
  SearchSessionModel: { findById: vi.fn() },
  JobModel: { find: vi.fn(), findByIdAndUpdate: vi.fn() },
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

const STORED_JOBS = [
  { _id: 'job1', title: 'Product Manager', company: 'Acme', description: 'd', url: 'http://x/1', salary: '', location: 'Munich' },
  { _id: 'job2', title: 'Product Owner', company: 'Beta', description: 'd', url: 'http://x/2', salary: '', location: 'Munich' },
]

beforeEach(async () => {
  vi.resetModules()
  ;({ eventHandlers } = await import('../handlers.js'))
  ;({ SearchSessionModel, JobModel } = await import('../../db/models.js'))
  ;({ callLLMJson } = await import('../../ai/llm.js'))
  vi.clearAllMocks()
})

describe('jobs_extracted handler (issue #187)', () => {
  it('broadcasts stored jobs immediately, even if scoring stalls', async () => {
    const session = { _id: 'sess1', query: 'Product Manager in Munich', jobsScored: 0, save: vi.fn() }
    vi.mocked(SearchSessionModel.findById).mockResolvedValue(session as any)
    vi.mocked(JobModel.find).mockResolvedValue(STORED_JOBS as any)
    vi.mocked(callLLMJson).mockReturnValue(new Promise(() => {}))

    const handler = eventHandlers.jobs_extracted({ searchId: 'sess1', jobIds: ['job1', 'job2'] }, MOCK_SSE)
    const outcome = await Promise.race([
      handler.then(() => 'scored'),
      (async () => {
        // Give the handler a beat to reach the (hung) scoring call, then check.
        await new Promise(resolve => setTimeout(resolve, 500))
        const calls = MOCK_SSE.broadcast.mock.calls as Array<[string, { type?: string; payload?: any }]>
        return calls.some(([, msg]) => msg?.type === 'results_updated') ? 'streamed' : 'hidden'
      })(),
    ])

    expect(outcome).toBe('streamed')
    const calls = MOCK_SSE.broadcast.mock.calls as Array<[string, { type?: string; payload?: any }]>
    const [, msg] = calls.find(([, m]) => m?.type === 'results_updated')!
    expect(msg.payload.jobs.map((j: any) => j.id).sort()).toEqual(['job1', 'job2'])
  })
})
