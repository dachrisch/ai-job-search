import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

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
let addEvent: typeof import('../../events/queue.js')['addEvent']

const MOCK_SSE = { broadcast: vi.fn() } as any

const STORED_JOBS = [
  { _id: 'job1', title: 'Product Manager', company: 'Acme', description: 'd', url: 'http://x/1', salary: '', location: 'Munich' },
  { _id: 'job2', title: 'Product Owner', company: 'Beta', description: 'd', url: 'http://x/2', salary: '', location: 'Munich' },
]

function makeJobs(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    _id: `job${i}`,
    title: `Product Manager ${i}`,
    company: `Company ${i}`,
    description: 'd',
    url: `http://x/${i}`,
    salary: '',
    location: 'Munich',
  }))
}

/** Answer a scoring prompt with one score per JobID it actually contains. */
function scoreFromPrompt(prompt: string) {
  const ids = [...prompt.matchAll(/JobID: (\S+)/g)].map(m => m[1])
  return { scores: ids.map(id => ({ jobId: id, matchScore: 50, reasoning: 'ok' })) }
}

function mockSession() {
  return {
    _id: 'sess1',
    query: 'Product Manager in Munich',
    jobsScored: 0,
    foundJobs: [] as string[],
    iterationCount: 0,
    save: vi.fn(),
  }
}

beforeEach(async () => {
  vi.resetModules()
  ;({ eventHandlers } = await import('../handlers.js'))
  ;({ SearchSessionModel, JobModel } = await import('../../db/models.js'))
  ;({ callLLMJson } = await import('../../ai/llm.js'))
  ;({ addEvent } = await import('../../events/queue.js'))
  vi.clearAllMocks()
})

describe('jobs_extracted handler (issue #187)', () => {
  it('records the scored job ids on the session so status reports a real count', async () => {
    const session = {
      _id: 'sess1',
      query: 'Product Manager in Munich',
      jobsScored: 0,
      foundJobs: [] as string[],
      iterationCount: 0,
      save: vi.fn(),
    }
    vi.mocked(SearchSessionModel.findById).mockResolvedValue(session as any)
    vi.mocked(JobModel.find).mockResolvedValue(STORED_JOBS as any)
    vi.mocked(JobModel.findByIdAndUpdate).mockResolvedValue({} as any)
    vi.mocked(callLLMJson).mockResolvedValue({
      scores: [
        { jobId: 'job1', matchScore: 80, reasoning: 'fits' },
        { jobId: 'job2', matchScore: 40, reasoning: 'partial' },
      ],
    } as any)

    await eventHandlers.jobs_extracted({ searchId: 'sess1', jobIds: ['job1', 'job2'] }, MOCK_SSE)

    expect(session.foundJobs).toEqual(['job1', 'job2'])
    expect(session.iterationCount).toBe(1)
    expect(session.save).toHaveBeenCalled()
  })

  it('records the found job ids before scoring, so a scoring failure still reports them', async () => {
    const session = {
      _id: 'sess1',
      query: 'Product Manager in Munich',
      jobsScored: 0,
      foundJobs: [] as string[],
      iterationCount: 0,
      save: vi.fn(),
    }
    vi.mocked(SearchSessionModel.findById).mockResolvedValue(session as any)
    vi.mocked(JobModel.find).mockResolvedValue(STORED_JOBS as any)
    vi.mocked(callLLMJson).mockRejectedValue(new Error('opencode reply timed out'))

    await eventHandlers.jobs_extracted({ searchId: 'sess1', jobIds: ['job1', 'job2'] }, MOCK_SSE)

    expect(session.foundJobs).toEqual(['job1', 'job2'])
    expect(session.iterationCount).toBe(1)
    expect(session.jobsScored).toBe(0)
  })

  it('broadcasts stored jobs immediately, even if scoring stalls', async () => {
    const session = { _id: 'sess1', query: 'Product Manager in Munich', jobsScored: 0, foundJobs: [], iterationCount: 0, save: vi.fn() }
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

describe('jobs_extracted handler: scoring batches', () => {
  const OLD_BATCH = process.env.SCORING_BATCH_SIZE

  beforeEach(() => {
    process.env.SCORING_BATCH_SIZE = '25'
    vi.mocked(JobModel.findByIdAndUpdate).mockResolvedValue({} as any)
  })

  afterEach(() => {
    if (OLD_BATCH === undefined) delete process.env.SCORING_BATCH_SIZE
    else process.env.SCORING_BATCH_SIZE = OLD_BATCH
  })

  it('splits a large job set into bounded LLM calls', async () => {
    // A 353-job prompt took 144 s against the paid model, past the 60 s poll
    // timeout; batches keep every call inside the budget.
    const jobs = makeJobs(60)
    vi.mocked(SearchSessionModel.findById).mockResolvedValue(mockSession() as any)
    vi.mocked(JobModel.find).mockResolvedValue(jobs as any)
    vi.mocked(callLLMJson).mockImplementation(async (prompt: string) => scoreFromPrompt(prompt) as any)

    await eventHandlers.jobs_extracted({ searchId: 'sess1', jobIds: jobs.map(j => j._id) }, MOCK_SSE)

    expect(callLLMJson).toHaveBeenCalledTimes(3)
    for (const [prompt] of vi.mocked(callLLMJson).mock.calls) {
      const jobCount = (String(prompt).match(/JobID:/g) || []).length
      expect(jobCount).toBeGreaterThan(0)
      expect(jobCount).toBeLessThanOrEqual(25)
    }
    // Every job still gets its score applied.
    expect(vi.mocked(JobModel.findByIdAndUpdate)).toHaveBeenCalledTimes(60)
  })

  it('keeps scores from the batches that succeeded when one fails', async () => {
    const jobs = makeJobs(60)
    vi.mocked(SearchSessionModel.findById).mockResolvedValue(mockSession() as any)
    vi.mocked(JobModel.find).mockResolvedValue(jobs as any)
    vi.mocked(callLLMJson).mockImplementation(async (prompt: string) => {
      // Fail the last (smallest) batch only.
      if ((String(prompt).match(/JobID:/g) || []).length === 10) {
        throw new Error('opencode reply timed out after 60s')
      }
      return scoreFromPrompt(prompt) as any
    })

    await eventHandlers.jobs_extracted({ searchId: 'sess1', jobIds: jobs.map(j => j._id) }, MOCK_SSE)

    expect(vi.mocked(JobModel.findByIdAndUpdate)).toHaveBeenCalledTimes(50)
    expect(addEvent).not.toHaveBeenCalledWith('search_failed', expect.anything())
  })

  it('fails the search only when every batch fails', async () => {
    const jobs = makeJobs(30)
    vi.mocked(SearchSessionModel.findById).mockResolvedValue(mockSession() as any)
    vi.mocked(JobModel.find).mockResolvedValue(jobs as any)
    vi.mocked(callLLMJson).mockRejectedValue(new Error('opencode reply timed out after 60s'))

    await eventHandlers.jobs_extracted({ searchId: 'sess1', jobIds: jobs.map(j => j._id) }, MOCK_SSE)

    expect(addEvent).toHaveBeenCalledWith('search_failed', expect.objectContaining({ searchId: 'sess1' }))
  })
})

