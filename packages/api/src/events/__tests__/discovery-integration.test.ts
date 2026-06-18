import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { connect, disconnect } from 'mongoose'
import { SearchSessionModel, CompanyModel } from '../../db/models.js'
import { eventHandlers } from '../handlers.js'
import { addEvent } from '../queue.js'
import { SSEManager } from '../../utils/SSEManager.js'
import { SearchSourceManager } from '../../search-sources/searxng-source.js'

// Mock the external dependencies
vi.mock('../../search-sources/searxng-source.js')
vi.mock('../../claude/client.js')
vi.mock('../../events/queue.js')

describe.skipIf(process.env.CI === 'true')('Discovery Integration Flow', () => {
  let mongoUri: string
  let sseManager: SSEManager

  beforeAll(async () => {
    // Use the test MongoDB instance on servyy-test.lxd (skipped in CI)
    mongoUri = process.env.MONGODB_URI || 'mongodb://10.185.182.250:27017/job_search_test'
    console.log(`Connecting to MongoDB at ${mongoUri}`)
    await connect(mongoUri)
  })

  afterAll(async () => {
    // Clean up test data
    await CompanyModel.deleteMany({})
    await SearchSessionModel.deleteMany({})
    await disconnect()
  })

  beforeEach(() => {
    vi.clearAllMocks()

    // Mock SSEManager for broadcasting updates
    sseManager = {
      broadcast: vi.fn(),
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
    } as any

    // Mock addEvent to track event emissions
    vi.mocked(addEvent).mockResolvedValue('job-1')
  })

  describe('search_started → companies_discovered flow', () => {
    it('should discover companies via SearchSourceManager and emit companies_discovered event', async () => {
      // ARRANGE: Create a search session
      const session = await SearchSessionModel.create({
        userId: '000000000000000000000001',
        query: 'senior engineer',
        status: 'running',
        iterationCount: 0,
        startedAt: new Date(),
        claudeConversationHistory: [],
        foundJobs: [],
        sitesSearched: [],
      })

      // Mock SearchSourceManager to return discovered companies
      const discoveredCompanies = [
        {
          url: 'https://stripe.com/careers',
          name: 'Stripe',
          title: 'Stripe Careers',
          snippet: 'Join Stripe engineering team',
          confidence: 'high' as const,
        },
        {
          url: 'https://github.com/careers',
          name: 'GitHub',
          title: 'GitHub Careers',
          snippet: 'Work at GitHub',
          confidence: 'high' as const,
        },
      ]

      vi.mocked(SearchSourceManager).mockImplementation(
        () =>
          ({
            discoverCompanies: vi.fn().mockResolvedValue(discoveredCompanies),
          }) as any
      )

      // ACT: Call search_started handler
      await eventHandlers.search_started(
        {
          searchId: session._id.toString(),
          userId: '000000000000000000000001',
          query: 'senior engineer',
        },
        sseManager
      )

      // ASSERT: Verify companies_discovered event was emitted with correct data
      expect(vi.mocked(addEvent)).toHaveBeenCalledWith(
        'companies_discovered',
        expect.objectContaining({
          searchId: session._id.toString(),
          userQuery: 'senior engineer',
          companies: expect.arrayContaining([
            expect.objectContaining({
              url: 'https://stripe.com/careers',
              name: 'Stripe',
              discoveredFrom: 'searxng',
              confidence: 'high',
            }),
            expect.objectContaining({
              url: 'https://github.com/careers',
              name: 'GitHub',
              discoveredFrom: 'searxng',
              confidence: 'high',
            }),
          ]),
        })
      )
    })

    it('should fail gracefully when no companies are discovered', async () => {
      // ARRANGE: Create a search session
      const session = await SearchSessionModel.create({
        userId: '000000000000000000000002',
        query: 'nonexistent company xyz',
        status: 'running',
        iterationCount: 0,
        startedAt: new Date(),
        claudeConversationHistory: [],
        foundJobs: [],
        sitesSearched: [],
      })

      // Mock SearchSourceManager to return empty results
      vi.mocked(SearchSourceManager).mockImplementation(
        () =>
          ({
            discoverCompanies: vi.fn().mockResolvedValue([]),
          }) as any
      )

      // ACT: Call search_started handler
      await eventHandlers.search_started(
        {
          searchId: session._id.toString(),
          userId: '000000000000000000000002',
          query: 'nonexistent company xyz',
        },
        sseManager
      )

      // ASSERT: Verify search_failed event was emitted
      expect(vi.mocked(addEvent)).toHaveBeenCalledWith(
        'search_failed',
        expect.objectContaining({
          searchId: session._id.toString(),
          error: 'No company career pages found',
        })
      )
    })
  })

  describe('companies_discovered → storage → companies_queued_for_crawl flow', () => {
    it('should store discovered companies and emit companies_queued_for_crawl event', async () => {
      // ARRANGE: Create a search session
      const session = await SearchSessionModel.create({
        userId: '000000000000000000000003',
        query: 'backend developer',
        status: 'running',
        iterationCount: 0,
        startedAt: new Date(),
        claudeConversationHistory: [],
        foundJobs: [],
        sitesSearched: [],
      })

      const companiesData = [
        {
          url: 'https://stripe.com/careers',
          name: 'Stripe',
          discoveredFrom: 'searxng',
          confidence: 'high' as const,
        },
        {
          url: 'https://github.com/careers',
          name: 'GitHub',
          discoveredFrom: 'searxng',
          confidence: 'high' as const,
        },
      ]

      // ACT: Call companies_discovered handler
      await eventHandlers.companies_discovered(
        {
          searchId: session._id.toString(),
          companies: companiesData,
          userQuery: 'backend developer',
        },
        sseManager
      )

      // ASSERT: Verify companies were stored in MongoDB
      const storedCompanies = await CompanyModel.find({
        searchQuery: 'backend developer',
      })

      expect(storedCompanies).toHaveLength(2)
      expect(storedCompanies[0]).toMatchObject({
        name: expect.stringMatching(/Stripe|GitHub/),
        status: 'pending_crawl',
        discoveredFrom: 'searxng',
        searchQuery: 'backend developer',
        crawlAttempts: 0,
      })

      // ASSERT: Verify SearchSession was updated with discovery stats
      const updatedSession = await SearchSessionModel.findById(session._id)
      expect(updatedSession).toMatchObject({
        companiesDiscovered: 2,
        companiesRemaining: 2,
      })

      // ASSERT: Verify companies_queued_for_crawl event was emitted
      expect(vi.mocked(addEvent)).toHaveBeenCalledWith(
        'companies_queued_for_crawl',
        expect.objectContaining({
          searchId: session._id.toString(),
          companyIds: expect.arrayContaining(
            storedCompanies.map(c => c._id.toString())
          ),
        })
      )
    })

    it('should batch companies for crawling (max 10 per batch)', async () => {
      // ARRANGE: Create a search session
      const session = await SearchSessionModel.create({
        userId: '000000000000000000000004',
        query: 'software engineer',
        status: 'running',
        iterationCount: 0,
        startedAt: new Date(),
        claudeConversationHistory: [],
        foundJobs: [],
        sitesSearched: [],
      })

      // Create 15 companies to test batching
      const companiesData = Array.from({ length: 15 }, (_, i) => ({
        url: `https://company${i}.com/careers`,
        name: `Company ${i}`,
        discoveredFrom: 'searxng',
        confidence: 'high' as const,
      }))

      // ACT: Call companies_discovered handler
      await eventHandlers.companies_discovered(
        {
          searchId: session._id.toString(),
          companies: companiesData,
          userQuery: 'software engineer',
        },
        sseManager
      )

      // ASSERT: Verify only 10 companies in first batch (not all 15)
      const callArgs = vi.mocked(addEvent).mock.calls.find(
        call => call[0] === 'companies_queued_for_crawl'
      )
      const companyIds = (callArgs?.[1] as any)?.companyIds || []
      expect(companyIds).toHaveLength(10)

      // ASSERT: Verify all 15 companies stored
      const storedCompanies = await CompanyModel.find({
        searchQuery: 'software engineer',
      })
      expect(storedCompanies).toHaveLength(15)
    })
  })

  describe('full discovery flow validation', () => {
    it('should validate complete discovery → storage → queuing pipeline', async () => {
      // ARRANGE: Create a search session
      const session = await SearchSessionModel.create({
        userId: '000000000000000000000005',
        query: 'devops engineer',
        status: 'running',
        iterationCount: 0,
        startedAt: new Date(),
        claudeConversationHistory: [],
        foundJobs: [],
        sitesSearched: [],
      })

      // Mock SearchSourceManager
      const discoveredCompanies = [
        {
          url: 'https://hashicorp.com/careers',
          name: 'HashiCorp',
          title: 'HashiCorp Careers',
          snippet: 'Join HashiCorp',
          confidence: 'high' as const,
        },
        {
          url: 'https://docker.com/careers',
          name: 'Docker',
          title: 'Docker Careers',
          snippet: 'Work at Docker',
          confidence: 'medium' as const,
        },
      ]

      vi.mocked(SearchSourceManager).mockImplementation(
        () =>
          ({
            discoverCompanies: vi.fn().mockResolvedValue(discoveredCompanies),
          }) as any
      )

      // ACT: Phase 1 - search_started discovers companies
      await eventHandlers.search_started(
        {
          searchId: session._id.toString(),
          userId: '000000000000000000000005',
          query: 'devops engineer',
        },
        sseManager
      )

      // Verify companies_discovered was emitted
      let eventCall = vi.mocked(addEvent).mock.calls.find(
        call => call[0] === 'companies_discovered'
      )
      expect(eventCall).toBeDefined()
      const companiesDiscoveredData = eventCall?.[1]

      // ACT: Phase 2 - companies_discovered stores companies and queues them
      await eventHandlers.companies_discovered(
        {
          searchId: session._id.toString(),
          companies: (companiesDiscoveredData as any).companies,
          userQuery: 'devops engineer',
        },
        sseManager
      )

      // ASSERT: All validations
      // 1. Companies stored in DB
      const storedCompanies = await CompanyModel.find({
        searchQuery: 'devops engineer',
      })
      expect(storedCompanies).toHaveLength(2)

      // 2. SearchSession updated
      const updatedSession = await SearchSessionModel.findById(session._id)
      expect(updatedSession?.companiesDiscovered).toBe(2)
      expect(updatedSession?.companiesRemaining).toBe(2)

      // 3. companies_queued_for_crawl event emitted
      eventCall = vi.mocked(addEvent).mock.calls.find(
        call => call[0] === 'companies_queued_for_crawl'
      )
      expect(eventCall).toBeDefined()
      const crawlQueueData = eventCall?.[1]
      expect((crawlQueueData as any).companyIds).toHaveLength(2)

      // 4. Verify company data integrity
      expect(storedCompanies[0]).toMatchObject({
        status: 'pending_crawl',
        discoveredFrom: 'searxng',
        crawlAttempts: 0,
      })
    })
  })
})
