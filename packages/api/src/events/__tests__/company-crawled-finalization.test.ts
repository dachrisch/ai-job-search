import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../db/models.js', () => ({
  SearchSessionModel: { findById: vi.fn() },
  JobModel: { find: vi.fn(), create: vi.fn(), countDocuments: vi.fn() },
  SiteModel: {},
  CompanyModel: { findById: vi.fn(), find: vi.fn(), countDocuments: vi.fn() },
}))
vi.mock('../../events/queue.js', () => ({ addEvent: vi.fn() }))
vi.mock('../../utils/pipeline.js', () => ({ emitPipelineEvent: vi.fn() }))
vi.mock('../../ai/llm.js', () => ({ callLLM: vi.fn(), callLLMJson: vi.fn() }))

let eventHandlers: typeof import('../handlers.js')['eventHandlers']
let SearchSessionModel: typeof import('../../db/models.js')['SearchSessionModel']
let CompanyModel: typeof import('../../db/models.js')['CompanyModel']
let JobModel: typeof import('../../db/models.js')['JobModel']
let addEvent: typeof import('../../events/queue.js')['addEvent']

const MOCK_SSE = { broadcast: vi.fn() } as any

type CompanyRow = { _id: string; status: string }

/** Minimal stand-in for Mongo's matcher on the fields the handler filters by. */
function matches(filter: any, row: CompanyRow): boolean {
  if (filter._id && filter._id.$ne && filter._id.$ne === row._id) return false
  if (typeof filter.status === 'string' && filter.status !== row.status) return false
  if (filter.status?.$in && !filter.status.$in.includes(row.status)) return false
  return true
}

function mockCompanies(rows: CompanyRow[]) {
  vi.mocked(CompanyModel.countDocuments).mockImplementation((filter: any) =>
    Promise.resolve(rows.filter(row => matches(filter, row)).length) as any
  )
}

function mockSession() {
  return {
    _id: 'sess1',
    userId: 'user1',
    query: 'Product Manager in Munich',
    status: 'running',
    iterationCount: 0,
    foundJobs: [] as string[],
    companiesCrawled: 0,
    companiesDiscovered: 1,
    companiesRemaining: 1,
    jobsExtracted: 0,
    jobsFilteredOut: 0,
    jobsScored: 0,
    expandedSearch: false,
    save: vi.fn(),
  }
}

beforeEach(async () => {
  vi.resetModules()
  ;({ eventHandlers } = await import('../handlers.js'))
  ;({ SearchSessionModel, CompanyModel, JobModel } = await import('../../db/models.js'))
  ;({ addEvent } = await import('../../events/queue.js'))
  vi.clearAllMocks()

  vi.mocked(CompanyModel.findById).mockResolvedValue({ _id: 'co1', name: 'IDnow', status: 'crawling', save: vi.fn() } as any)
  vi.mocked(CompanyModel.find).mockResolvedValue([] as any)
  vi.mocked(JobModel.countDocuments).mockResolvedValue(0 as any)
  vi.mocked(JobModel.find).mockResolvedValue([] as any)
})

describe('company_crawled finalization', () => {
  it('does not finalize the search while another company is still crawling', async () => {
    vi.mocked(SearchSessionModel.findById).mockResolvedValue(mockSession() as any)
    mockCompanies([
      { _id: 'co1', status: 'crawling' },
      { _id: 'co2', status: 'crawled' },
    ])

    await eventHandlers.company_crawled(
      { searchId: 'sess1', companyId: 'co1', jobs: [], discoveredCompanies: [] },
      MOCK_SSE
    )

    expect(addEvent).not.toHaveBeenCalledWith('search_evaluation', expect.anything())
    expect(addEvent).not.toHaveBeenCalledWith('search_complete', expect.anything())
  })

  it('finalizes once no company is pending or crawling', async () => {
    vi.mocked(SearchSessionModel.findById).mockResolvedValue(mockSession() as any)
    mockCompanies([{ _id: 'co1', status: 'crawled' }])

    await eventHandlers.company_crawled(
      { searchId: 'sess1', companyId: 'co1', jobs: [], discoveredCompanies: [] },
      MOCK_SSE
    )

    expect(addEvent).toHaveBeenCalledWith('search_evaluation', expect.objectContaining({ searchId: 'sess1' }))
  })
})
