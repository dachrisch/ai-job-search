import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { DiscoveredCompany } from '@job-search/shared'

// Set up environment variables before any imports
process.env.SEARXNG_URL = 'https://search.lehel.xyz'
process.env.SEARXNG_TOKEN = 'test-token'
process.env.JOB_AGGREGATOR_BLOCKLIST = 'indeed.com,linkedin.com,glassdoor.com,dice.com,builtin.com,monster.com'

// Mock axios and the LLM facade before importing the module
vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}))
vi.mock('../src/ai/llm.js')

import axios from 'axios'
import { callLLMJson } from '../src/ai/llm.js'
import { SearchSourceManager } from '../src/search-sources/searxng-source.js'

function makeManager(): SearchSourceManager {
  return new SearchSourceManager()
}

describe('SearchSourceManager', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    // Default SearXNG responses: empty
    vi.mocked(axios.get).mockResolvedValue({ data: { results: [] } })
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('constructor', () => {
    it('should not require an API key', () => {
      expect(() => new SearchSourceManager()).not.toThrow()
    })
  })

  describe('discoverCompanies', () => {
    it('should return empty array when SearXNG returns no results', async () => {
      vi.mocked(callLLMJson).mockResolvedValue({
        queries: [{ q: 'golang engineer', intent: 'test' }],
      })

      const result = await makeManager().discoverCompanies('test-search-id', 'golang engineer')

      expect(result).toEqual([])
      const callArgs = vi.mocked(axios.get).mock.calls[0]
      expect(callArgs[0]).toBe('https://search.lehel.xyz/search')
      expect(callArgs[1]?.params?.format).toBe('json')
      expect(callArgs[1]?.params?.tokens).toBe('test-token')
    })

    it('should paginate SearXNG queries (p=1..3)', async () => {
      vi.mocked(callLLMJson).mockResolvedValue({
        queries: [{ q: 'golang engineer', intent: 'test' }],
      })

      await makeManager().discoverCompanies('test-search-id', 'golang engineer')

      const pages = vi.mocked(axios.get).mock.calls.map(call => call[1]?.params?.p)
      expect(pages).toContain(1)
      expect(pages).toContain(2)
      expect(pages).toContain(3)
    })

    it('should filter out job aggregators and return validated company pages', async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: {
          results: [
            {
              title: 'Indeed Jobs',
              url: 'https://www.indeed.com/jobs?q=developer',
              content: 'Find jobs on Indeed',
              engine: 'google',
            },
            {
              title: 'TechCorp Careers',
              url: 'https://careers.techcorp.com',
              content: 'Join our team at TechCorp',
              engine: 'google',
            },
            {
              title: 'StartupXYZ Team',
              url: 'https://startupxyz.com/careers',
              content: 'We are hiring engineers',
              engine: 'google',
            },
          ],
        },
      })

      vi.mocked(callLLMJson).mockImplementation(async (prompt) => {
        if (prompt.includes('job-discovery strategist')) {
          return { queries: [{ q: 'developer', intent: 'test' }] }
        }
        if (prompt.includes('analyzing search results')) {
          return [
            {
              url: 'https://careers.techcorp.com',
              isCompanyPage: true,
              companyName: 'TechCorp',
              hiddenGemScore: 30,
              sizeSignals: ['large company'],
              sizeBand: 'large',
              confidence: 'high',
            },
            {
              url: 'https://startupxyz.com/careers',
              isCompanyPage: true,
              companyName: 'StartupXYZ',
              hiddenGemScore: 85,
              sizeSignals: ['team of 20'],
              sizeBand: 'small',
              confidence: 'high',
            },
          ]
        }
        if (prompt.includes('Rank these discovered companies')) {
          return ['https://startupxyz.com/careers', 'https://careers.techcorp.com']
        }
        return []
      })

      const result = await makeManager().discoverCompanies('test-search-id', 'developer')

      expect(result).toHaveLength(2)
      expect(result.every(c => c.name !== 'Indeed' && c.name !== 'LinkedIn')).toBe(true)
      expect(result[0].name).toBe('StartupXYZ')
      expect(result[0].hiddenGemScore).toBe(85)
      expect(result[0].sizeBand).toBe('small')
      expect(result[1].name).toBe('TechCorp')
    })

    it('should include title and snippet from search results', async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: {
          results: [
            {
              title: 'TechCorp - Careers',
              url: 'https://techcorp.com/careers',
              content: 'We are looking for talented engineers',
              engine: 'google',
            },
          ],
        },
      })

      vi.mocked(callLLMJson).mockImplementation(async (prompt) => {
        if (prompt.includes('job-discovery strategist')) {
          return { queries: [{ q: 'developer', intent: 'test' }] }
        }
        if (prompt.includes('analyzing search results')) {
          return [
            {
              url: 'https://techcorp.com/careers',
              isCompanyPage: true,
              companyName: 'TechCorp',
              hiddenGemScore: 70,
              sizeSignals: [],
              sizeBand: 'medium',
              confidence: 'high',
            },
          ]
        }
        if (prompt.includes('Rank these discovered companies')) {
          return ['https://techcorp.com/careers']
        }
        return []
      })

      const result = await makeManager().discoverCompanies('test-search-id', 'developer')

      expect(result).toHaveLength(1)
      expect(result[0].title).toBe('TechCorp - Careers')
      expect(result[0].snippet).toBe('We are looking for talented engineers')
    })

    it('should use domain as fallback when LLM does not provide company name', async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: {
          results: [
            {
              title: 'Jobs',
              url: 'https://example-company.com/jobs',
              content: 'Join our team',
              engine: 'google',
            },
          ],
        },
      })

      vi.mocked(callLLMJson).mockImplementation(async (prompt) => {
        if (prompt.includes('job-discovery strategist')) {
          return { queries: [{ q: 'developer', intent: 'test' }] }
        }
        if (prompt.includes('analyzing search results')) {
          return [
            {
              url: 'https://example-company.com/jobs',
              isCompanyPage: true,
              companyName: null,
              hiddenGemScore: 65,
              sizeSignals: [],
              sizeBand: 'unknown',
              confidence: 'medium',
            },
          ]
        }
        if (prompt.includes('Rank these discovered companies')) {
          return ['https://example-company.com/jobs']
        }
        return []
      })

      const result = await makeManager().discoverCompanies('test-search-id', 'developer')

      expect(result[0].name).toBe('example-company.com')
    })

    it('should propagate LLM failures (fail loudly)', async () => {
      vi.mocked(callLLMJson).mockRejectedValue(new Error('opencode unavailable'))

      await expect(
        makeManager().discoverCompanies('test-search-id', 'developer')
      ).rejects.toThrow('opencode unavailable')
    })

    it('should throw error when SearXNG call fails', async () => {
      vi.mocked(callLLMJson).mockResolvedValue({
        queries: [{ q: 'developer', intent: 'test' }],
      })
      vi.mocked(axios.get).mockRejectedValueOnce(new Error('Network error'))

      await expect(
        makeManager().discoverCompanies('test-search-id', 'developer')
      ).rejects.toThrow('Network error')
    })

    it('should use SEARXNG_URL from environment', async () => {
      process.env.SEARXNG_URL = 'https://custom.searxng.xyz'
      const manager = new SearchSourceManager()
      vi.mocked(callLLMJson).mockResolvedValue({
        queries: [{ q: 'developer', intent: 'test' }],
      })

      await manager.discoverCompanies('test-search-id', 'developer')

      const callUrl = vi.mocked(axios.get).mock.calls[0][0]
      expect(callUrl).toBe('https://custom.searxng.xyz/search')
    })
  })

  describe('isJobAggregator', () => {
    it('should identify Indeed as aggregator', () => {
      const result = (makeManager() as any).isJobAggregator('https://www.indeed.com/jobs')
      expect(result).toBe(true)
    })

    it('should identify LinkedIn as aggregator', () => {
      const result = (makeManager() as any).isJobAggregator('https://www.linkedin.com/jobs/search/')
      expect(result).toBe(true)
    })

    it('should not identify company career page as aggregator', () => {
      const result = (makeManager() as any).isJobAggregator('https://techcorp.com/careers')
      expect(result).toBe(false)
    })

    it('should handle invalid URLs gracefully', () => {
      const result = (makeManager() as any).isJobAggregator('not-a-valid-url')
      expect(result).toBe(false)
    })

    it('should be case insensitive', () => {
      const result = (makeManager() as any).isJobAggregator('https://www.INDEED.COM/jobs')
      expect(result).toBe(true)
    })
  })

  describe('extractDomain', () => {
    it('should extract domain from full URL', () => {
      const domain = (makeManager() as any).extractDomain('https://www.example.com/careers')
      expect(domain).toBe('example.com')
    })

    it('should remove www prefix', () => {
      const domain = (makeManager() as any).extractDomain('https://www.techcorp.io')
      expect(domain).toBe('techcorp.io')
    })

    it('should handle URLs without www', () => {
      const domain = (makeManager() as any).extractDomain('https://api.company.com')
      expect(domain).toBe('api.company.com')
    })

    it('should handle invalid URLs gracefully', () => {
      const domain = (makeManager() as any).extractDomain('invalid-url')
      expect(domain).toBe('invalid-url')
    })
  })
})