import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../db/models.js', () => ({
  SearchSessionModel: { findById: vi.fn() },
  CompanyModel: { findById: vi.fn(), findByIdAndUpdate: vi.fn() },
}))
vi.mock('../../events/queue.js', () => ({ addEvent: vi.fn() }))
vi.mock('axios', () => ({ default: { post: vi.fn() } }))

let eventHandlers: typeof import('../handlers.js')['eventHandlers']
let SearchSessionModel: typeof import('../../db/models.js')['SearchSessionModel']
let CompanyModel: typeof import('../../db/models.js')['CompanyModel']
let addEvent: typeof import('../../events/queue.js')['addEvent']
let axios: typeof import('axios')['default']

const MOCK_SESSION = { _id: 'sess1', userId: 'user1', query: 'engineer' }
const MOCK_SSE = { broadcast: vi.fn() } as any
const HANDLER_DATA = { searchId: 'sess1', companyId: 'co1', url: 'https://ibm.com/careers', companyName: 'IBM', query: 'engineer' }

beforeEach(async () => {
  vi.resetModules()
  ;({ eventHandlers } = await import('../handlers.js'))
  ;({ SearchSessionModel, CompanyModel } = await import('../../db/models.js'))
  ;({ addEvent } = await import('../../events/queue.js'))
  axios = (await import('axios')).default
  vi.clearAllMocks()
})

describe('crawl_company handler', () => {
  describe('standard path: crawler found jobs', () => {
    it('emits company_crawled with crawler jobs and unsupported=false', async () => {
      vi.mocked(SearchSessionModel.findById).mockResolvedValue(MOCK_SESSION as any)
      vi.mocked(axios.post).mockResolvedValue({
        data: { jobs: [{ title: 'Engineer', company: 'IBM' }], unsupported: false, discoveredCompanies: [] },
      })

      await eventHandlers.crawl_company(HANDLER_DATA, MOCK_SSE)

      expect(addEvent).toHaveBeenCalledWith('company_crawled', expect.objectContaining({
        searchId: 'sess1',
        companyId: 'co1',
        jobs: [{ title: 'Engineer', company: 'IBM' }],
        unsupported: false,
      }))
    })
  })

  describe('unsupported path: crawler found no jobs and no adapter matched', () => {
    it('emits company_crawled with unsupported=true', async () => {
      vi.mocked(SearchSessionModel.findById).mockResolvedValue(MOCK_SESSION as any)
      vi.mocked(axios.post).mockResolvedValue({
        data: { jobs: [], unsupported: true, discoveredCompanies: [] },
      })

      await eventHandlers.crawl_company(HANDLER_DATA, MOCK_SSE)

      expect(addEvent).toHaveBeenCalledWith('company_crawled', expect.objectContaining({
        jobs: [],
        unsupported: true,
      }))
    })
  })

  describe('error path: crawler request throws', () => {
    it('sets company status to failed', async () => {
      vi.mocked(SearchSessionModel.findById).mockResolvedValue(MOCK_SESSION as any)
      vi.mocked(axios.post).mockRejectedValue(new Error('timeout'))
      const mockCompany = { status: 'crawling', save: vi.fn() }
      vi.mocked(CompanyModel.findById).mockResolvedValue(mockCompany as any)

      await eventHandlers.crawl_company(HANDLER_DATA, MOCK_SSE)

      expect(mockCompany.status).toBe('failed')
      expect(mockCompany.save).toHaveBeenCalled()
    })
  })
})

describe('company_crawled handler', () => {
  it('sets Company.status to unsupported when data.unsupported is true', async () => {
    vi.mocked(SearchSessionModel.findById).mockResolvedValue({ _id: 'sess1', userId: 'user1', query: 'engineer' } as any)
    const mockCompany = { status: 'crawling', save: vi.fn() }
    vi.mocked(CompanyModel.findById).mockResolvedValue(mockCompany as any)

    await eventHandlers.company_crawled(
      { searchId: 'sess1', companyId: 'co1', jobs: [], discoveredCompanies: [], unsupported: true },
      MOCK_SSE
    )

    expect(mockCompany.status).toBe('unsupported')
    expect(mockCompany.save).toHaveBeenCalled()
  })

  it('sets Company.status to crawled when data.unsupported is false', async () => {
    vi.mocked(SearchSessionModel.findById).mockResolvedValue({ _id: 'sess1', userId: 'user1', query: 'engineer' } as any)
    const mockCompany = { status: 'crawling', save: vi.fn() }
    vi.mocked(CompanyModel.findById).mockResolvedValue(mockCompany as any)

    await eventHandlers.company_crawled(
      { searchId: 'sess1', companyId: 'co1', jobs: [{ title: 'Engineer' }], discoveredCompanies: [], unsupported: false },
      MOCK_SSE
    )

    expect(mockCompany.status).toBe('crawled')
    expect(mockCompany.save).toHaveBeenCalled()
  })
})
