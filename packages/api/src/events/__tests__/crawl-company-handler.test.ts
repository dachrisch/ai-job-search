import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock all external dependencies before importing the handler
vi.mock('../../db/models.js', () => ({
  SearchSessionModel: { findById: vi.fn() },
  CompanyModel: { findById: vi.fn(), findByIdAndUpdate: vi.fn() },
}))
vi.mock('../../events/queue.js', () => ({ addEvent: vi.fn() }))
vi.mock('axios', () => ({ default: { post: vi.fn() } }))
vi.mock('../../discovery/api-discoverer.js', () => ({ discoverJobsApi: vi.fn() }))
vi.mock('../../discovery/direct-fetcher.js', () => ({ fetchFromDiscoveredApi: vi.fn() }))

// With the repo's vitest isolate:false setting, the module registry is shared across
// test files within a worker. tests/handlers.test.ts mocks these same module paths and
// also imports handlers.js, so a stale cached instance (bound to its mocks) can otherwise
// leak in here depending on file/thread scheduling. Force a fresh import bound to *our*
// mocks every test.
let eventHandlers: typeof import('../handlers.js')['eventHandlers']
let SearchSessionModel: typeof import('../../db/models.js')['SearchSessionModel']
let CompanyModel: typeof import('../../db/models.js')['CompanyModel']
let addEvent: typeof import('../../events/queue.js')['addEvent']
let axios: typeof import('axios')['default']
let discoverJobsApi: typeof import('../../discovery/api-discoverer.js')['discoverJobsApi']
let fetchFromDiscoveredApi: typeof import('../../discovery/direct-fetcher.js')['fetchFromDiscoveredApi']

const MOCK_SESSION = { _id: 'sess1', userId: 'user1', query: 'engineer' }
const MOCK_COMPANY_NO_API = { _id: 'co1', name: 'IBM', url: 'https://ibm.com/careers', discoveredApi: undefined }
const MOCK_COMPANY_WITH_API = {
  _id: 'co1',
  name: 'IBM',
  url: 'https://ibm.com/careers',
  discoveredApi: {
    endpoint: 'https://ibm.wd3.myworkdayjobs.com/api/jobs',
    method: 'GET',
    paramTemplate: { q: '{keywords}' },
    fieldMapping: { title: 'title', url: 'url', location: 'city', description: 'summary' },
    discoveredAt: new Date(),
  },
}
const MOCK_SSE = { broadcast: vi.fn() } as any
const HANDLER_DATA = { searchId: 'sess1', companyId: 'co1', url: 'https://ibm.com/careers', companyName: 'IBM', query: 'engineer' }

beforeEach(async () => {
  vi.resetModules()
  ;({ eventHandlers } = await import('../handlers.js'))
  ;({ SearchSessionModel, CompanyModel } = await import('../../db/models.js'))
  ;({ addEvent } = await import('../../events/queue.js'))
  axios = (await import('axios')).default
  ;({ discoverJobsApi } = await import('../../discovery/api-discoverer.js'))
  ;({ fetchFromDiscoveredApi } = await import('../../discovery/direct-fetcher.js'))
  vi.clearAllMocks()
})

describe('crawl_company handler', () => {
  describe('fast path: company has discoveredApi and returns jobs', () => {
    it('calls fetchFromDiscoveredApi and emits company_crawled without calling crawler', async () => {
      vi.mocked(SearchSessionModel.findById).mockResolvedValue(MOCK_SESSION as any)
      vi.mocked(CompanyModel.findById).mockResolvedValue(MOCK_COMPANY_WITH_API as any)
      vi.mocked(fetchFromDiscoveredApi).mockResolvedValue([
        { title: 'Software Engineer', company: 'IBM', location: 'Berlin', url: 'https://ibm.com/jobs/1', description: 'Great role with many responsibilities', sourceUrl: 'https://ibm.com/careers' },
      ])

      await eventHandlers.crawl_company(HANDLER_DATA, MOCK_SSE)

      expect(axios.post).not.toHaveBeenCalled()
      expect(addEvent).toHaveBeenCalledWith('company_crawled', expect.objectContaining({
        searchId: 'sess1',
        companyId: 'co1',
        jobs: expect.arrayContaining([expect.objectContaining({ title: 'Software Engineer' })]),
      }))
    })
  })

  describe('re-discovery path: discoveredApi exists but returns 0 jobs', () => {
    it('clears discoveredApi and falls through to crawler', async () => {
      vi.mocked(SearchSessionModel.findById).mockResolvedValue(MOCK_SESSION as any)
      vi.mocked(CompanyModel.findById).mockResolvedValue(MOCK_COMPANY_WITH_API as any)
      vi.mocked(fetchFromDiscoveredApi).mockResolvedValue([])
      vi.mocked(axios.post).mockResolvedValue({ data: { jobs: [], needsDiscovery: false, networkCapture: [] } })

      await eventHandlers.crawl_company(HANDLER_DATA, MOCK_SSE)

      expect(CompanyModel.findByIdAndUpdate).toHaveBeenCalledWith('co1', { $unset: { discoveredApi: 1 } })
      expect(axios.post).toHaveBeenCalled()
    })
  })

  describe('discovery path: Scrapy returned 0 jobs and Playwright captured traffic', () => {
    it('calls discoverJobsApi, stores config, fetches jobs, emits company_crawled', async () => {
      vi.mocked(SearchSessionModel.findById).mockResolvedValue(MOCK_SESSION as any)
      vi.mocked(CompanyModel.findById).mockResolvedValue(MOCK_COMPANY_NO_API as any)
      vi.mocked(axios.post).mockResolvedValue({
        data: {
          jobs: [],
          needsDiscovery: true,
          networkCapture: [{ url: 'https://ibm.wd3.myworkdayjobs.com/api/jobs', method: 'GET', responseBody: '{"jobs":[]}', responseStatus: 200 }],
        },
      })
      const config = {
        endpoint: 'https://ibm.wd3.myworkdayjobs.com/api/jobs',
        method: 'GET' as const,
        paramTemplate: { q: '{keywords}' },
        fieldMapping: { title: 'title', url: 'url', location: 'city', description: 'summary' },
        discoveredAt: new Date(),
      }
      vi.mocked(discoverJobsApi).mockResolvedValue(config)
      vi.mocked(fetchFromDiscoveredApi).mockResolvedValue([
        { title: 'Software Engineer', company: 'IBM', location: 'Berlin', url: 'https://ibm.com/jobs/1', description: 'Great role', sourceUrl: 'https://ibm.com/careers' },
      ])

      await eventHandlers.crawl_company(HANDLER_DATA, MOCK_SSE)

      expect(discoverJobsApi).toHaveBeenCalledWith('user1', 'IBM', 'https://ibm.com/careers', expect.any(Array))
      expect(CompanyModel.findByIdAndUpdate).toHaveBeenCalledWith('co1', { discoveredApi: config })
      expect(addEvent).toHaveBeenCalledWith('company_crawled', expect.objectContaining({ jobs: expect.any(Array) }))
    })
  })

  describe('standard path: Scrapy found jobs', () => {
    it('emits company_crawled with Scrapy jobs directly', async () => {
      vi.mocked(SearchSessionModel.findById).mockResolvedValue(MOCK_SESSION as any)
      vi.mocked(CompanyModel.findById).mockResolvedValue(MOCK_COMPANY_NO_API as any)
      vi.mocked(axios.post).mockResolvedValue({
        data: { jobs: [{ title: 'Engineer', company: 'IBM' }], needsDiscovery: false, networkCapture: [] },
      })

      await eventHandlers.crawl_company(HANDLER_DATA, MOCK_SSE)

      expect(discoverJobsApi).not.toHaveBeenCalled()
      expect(addEvent).toHaveBeenCalledWith('company_crawled', expect.objectContaining({
        jobs: [{ title: 'Engineer', company: 'IBM' }],
      }))
    })
  })
})
