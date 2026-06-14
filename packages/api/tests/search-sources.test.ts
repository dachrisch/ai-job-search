import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { DiscoveredCompany } from '@job-search/shared'

// Set up environment variables before any imports
process.env.SEARXNG_URL = 'https://search.lehel.xyz'
process.env.SEARXNG_TOKEN = 'test-token'
process.env.JOB_AGGREGATOR_BLOCKLIST = 'indeed.com,linkedin.com,glassdoor.com,dice.com,builtin.com,monster.com'
// Create mock before any imports
const mockClaudeMessage = vi.fn()

// Mock axios and Anthropic before importing the module
vi.mock('axios')
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn(() => ({
    messages: {
      create: mockClaudeMessage
    }
  }))
}))

// Import after mocking and environment setup
import axios from 'axios'
import { SearchSourceManager } from '../src/search-sources/searxng-source.js'

describe('SearchSourceManager', () => {
  let manager: SearchSourceManager

  beforeEach(() => {
    // Set up environment variables BEFORE creating manager
    process.env.SEARXNG_URL = 'https://search.lehel.xyz'
    process.env.SEARXNG_TOKEN = 'test-token'
    process.env.JOB_AGGREGATOR_BLOCKLIST =
      'indeed.com,linkedin.com,glassdoor.com,dice.com,builtin.com,monster.com'

    manager = new SearchSourceManager('test-token')
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('discoverCompanies', () => {
    it('should return empty array when SearXNG returns no results', async () => {
      // Mock axios to return empty results
      vi.mocked(axios.get).mockResolvedValueOnce({
        data: { results: [] }
      })

      const result = await manager.discoverCompanies('test-search-id', 'typescript developer')

      expect(result).toEqual([])
      expect(axios.get).toHaveBeenCalledWith(
        'https://search.lehel.xyz/search',
        expect.objectContaining({
          params: expect.objectContaining({
            q: 'typescript developer careers',
            format: 'json'
          })
        })
      )
    })

    it('should filter out job aggregators from SearXNG results', async () => {
      // Mock SearXNG to return results including aggregators
      vi.mocked(axios.get).mockResolvedValueOnce({
        data: {
          results: [
            {
              title: 'Indeed Jobs',
              url: 'https://www.indeed.com/jobs?q=developer',
              content: 'Find jobs on Indeed',
              engine: 'google'
            },
            {
              title: 'LinkedIn Jobs',
              url: 'https://www.linkedin.com/jobs/search/',
              content: 'Find jobs on LinkedIn',
              engine: 'google'
            },
            {
              title: 'TechCorp Careers',
              url: 'https://careers.techcorp.com',
              content: 'Join our team at TechCorp',
              engine: 'google'
            },
            {
              title: 'StartupXYZ Team',
              url: 'https://startupxyz.com/careers',
              content: 'We are hiring engineers',
              engine: 'google'
            }
          ]
        }
      })

      // Mock Claude validation
      mockClaudeMessage.mockResolvedValueOnce({
        content: [
          {
            type: 'text',
            text: JSON.stringify([
              { url: 'https://careers.techcorp.com', isCompanyPage: true, companyName: 'TechCorp', confidence: 'high' },
              { url: 'https://startupxyz.com/careers', isCompanyPage: true, companyName: 'StartupXYZ', confidence: 'high' }
            ])
          }
        ]
      })

      const result = await manager.discoverCompanies('test-search-id', 'developer')

      // Should only have 2 companies (aggregators filtered out)
      expect(result).toHaveLength(2)
      expect(result[0].name).toBe('TechCorp')
      expect(result[1].name).toBe('StartupXYZ')
      // Should not contain Indeed or LinkedIn
      expect(result.every(c => c.name !== 'Indeed' && c.name !== 'LinkedIn')).toBe(true)
    })

    it('should return only validated company pages', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({
        data: {
          results: [
            {
              title: 'Company A Careers',
              url: 'https://companya.com/careers',
              content: 'Join Company A',
              engine: 'google'
            },
            {
              title: 'Company B Blog',
              url: 'https://companyb.com/blog',
              content: 'Latest news from Company B',
              engine: 'google'
            },
            {
              title: 'Company C Team',
              url: 'https://companyc.com/team',
              content: 'Meet our team',
              engine: 'google'
            }
          ]
        }
      })

      // Mock Claude to validate only some as company pages
      mockClaudeMessage.mockResolvedValueOnce({
        content: [
          {
            type: 'text',
            text: JSON.stringify([
              { url: 'https://companya.com/careers', isCompanyPage: true, companyName: 'Company A', confidence: 'high' },
              { url: 'https://companyb.com/blog', isCompanyPage: false, companyName: null, confidence: 'low' },
              { url: 'https://companyc.com/team', isCompanyPage: true, companyName: 'Company C', confidence: 'medium' }
            ])
          }
        ]
      })

      const result = await manager.discoverCompanies('test-search-id', 'developer')

      // Should only have Company A and Company C (B was not a company page)
      expect(result).toHaveLength(2)
      expect(result.map(c => c.name)).toEqual(['Company A', 'Company C'])
    })

    it('should include confidence levels in results', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({
        data: {
          results: [
            {
              title: 'Confident Company',
              url: 'https://confident.com/careers',
              content: 'Clear careers page',
              engine: 'google'
            },
            {
              title: 'Medium Confidence',
              url: 'https://medium.com/careers',
              content: 'Possible careers page',
              engine: 'google'
            }
          ]
        }
      })

      mockClaudeMessage.mockResolvedValueOnce({
        content: [
          {
            type: 'text',
            text: JSON.stringify([
              { url: 'https://confident.com/careers', isCompanyPage: true, companyName: 'Confident Co', confidence: 'high' },
              { url: 'https://medium.com/careers', isCompanyPage: true, companyName: 'Medium Co', confidence: 'medium' }
            ])
          }
        ]
      })

      const result = await manager.discoverCompanies('test-search-id', 'developer')

      expect(result[0].confidence).toBe('high')
      expect(result[1].confidence).toBe('medium')
    })

    it('should include title and snippet from search results', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({
        data: {
          results: [
            {
              title: 'TechCorp - Careers',
              url: 'https://techcorp.com/careers',
              content: 'We are looking for talented engineers',
              engine: 'google'
            }
          ]
        }
      })

      mockClaudeMessage.mockResolvedValueOnce({
        content: [
          {
            type: 'text',
            text: JSON.stringify([
              { url: 'https://techcorp.com/careers', isCompanyPage: true, companyName: 'TechCorp', confidence: 'high' }
            ])
          }
        ]
      })

      const result = await manager.discoverCompanies('test-search-id', 'developer')

      expect(result[0].title).toBe('TechCorp - Careers')
      expect(result[0].snippet).toBe('We are looking for talented engineers')
    })

    it('should use domain as fallback when LLM does not provide company name', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({
        data: {
          results: [
            {
              title: 'Jobs',
              url: 'https://example-company.com/jobs',
              content: 'Join our team',
              engine: 'google'
            }
          ]
        }
      })

      mockClaudeMessage.mockResolvedValueOnce({
        content: [
          {
            type: 'text',
            text: JSON.stringify([
              { url: 'https://example-company.com/jobs', isCompanyPage: true, companyName: null, confidence: 'medium' }
            ])
          }
        ]
      })

      const result = await manager.discoverCompanies('test-search-id', 'developer')

      expect(result[0].name).toBe('example-company.com')
    })

    it('should handle LLM validation errors gracefully', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({
        data: {
          results: [
            {
              title: 'Company A',
              url: 'https://companya.com',
              content: 'Content A',
              engine: 'google'
            }
          ]
        }
      })

      // Mock Claude to return invalid JSON
      mockClaudeMessage.mockResolvedValueOnce({
        content: [
          {
            type: 'text',
            text: 'This is not valid JSON'
          }
        ]
      })

      const result = await manager.discoverCompanies('test-search-id', 'developer')

      // Should return empty array when validation fails
      expect(result).toEqual([])
    })

    it('should limit validation to top 20 results', async () => {
      const results = Array.from({ length: 30 }, (_, i) => ({
        title: `Company ${i}`,
        url: `https://company${i}.com`,
        content: `Content ${i}`,
        engine: 'google'
      }))

      vi.mocked(axios.get).mockResolvedValueOnce({
        data: { results }
      })

      mockClaudeMessage.mockResolvedValueOnce({
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              Array.from({ length: 20 }, (_, i) => ({
                url: `https://company${i}.com`,
                isCompanyPage: true,
                companyName: `Company ${i}`,
                confidence: 'high'
              }))
            )
          }
        ]
      })

      const result = await manager.discoverCompanies('test-search-id', 'developer')

      // Verify Claude was called with only 20 results in the prompt
      const callArgs = mockClaudeMessage.mock.calls[0]
      const prompt = callArgs[0].messages[0].content
      expect(prompt).toContain('Company 0')
      expect(prompt).toContain('Company 19')
      // Should not contain Company 20 or later
      expect(prompt).not.toContain('Company 20')
    })

    it('should throw error when SearXNG call fails', async () => {
      vi.mocked(axios.get).mockRejectedValueOnce(new Error('Network error'))

      await expect(manager.discoverCompanies('test-search-id', 'developer')).rejects.toThrow('Network error')
    })

    it('should throw error when Claude validation fails', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({
        data: {
          results: [
            {
              title: 'Company',
              url: 'https://company.com',
              content: 'Content',
              engine: 'google'
            }
          ]
        }
      })

      mockClaudeMessage.mockRejectedValueOnce(new Error('Claude API error'))

      await expect(manager.discoverCompanies('test-search-id', 'developer')).rejects.toThrow('Claude API error')
    })

    it('should append " careers" to search query', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({
        data: { results: [] }
      })

      await manager.discoverCompanies('test-search-id', 'golang engineer')

      const callArgs = vi.mocked(axios.get).mock.calls[0]
      expect(callArgs[1]?.params?.q).toBe('golang engineer careers')
    })

    it('should use SEARXNG_URL from environment', async () => {
      process.env.SEARXNG_URL = 'https://custom.searxng.xyz'
      const customManager = new SearchSourceManager('test-token')

      vi.mocked(axios.get).mockResolvedValueOnce({
        data: { results: [] }
      })

      await customManager.discoverCompanies('test-search-id', 'developer')

      const callUrl = vi.mocked(axios.get).mock.calls[0][0]
      expect(callUrl).toBe('https://custom.searxng.xyz/search')
    })

    it('should respect blocklist from environment', async () => {
      process.env.JOB_AGGREGATOR_BLOCKLIST = 'custom-aggregator.com,another-agg.com'
      const customManager = new SearchSourceManager('test-token')

      vi.mocked(axios.get).mockResolvedValueOnce({
        data: {
          results: [
            {
              title: 'Custom Agg',
              url: 'https://custom-aggregator.com/jobs',
              content: 'Aggregator',
              engine: 'google'
            },
            {
              title: 'Real Company',
              url: 'https://real-company.com/careers',
              content: 'Careers',
              engine: 'google'
            }
          ]
        }
      })

      mockClaudeMessage.mockResolvedValueOnce({
        content: [
          {
            type: 'text',
            text: JSON.stringify([{ url: 'https://real-company.com/careers', isCompanyPage: true, companyName: 'Real Company', confidence: 'high' }])
          }
        ]
      })

      const result = await customManager.discoverCompanies('test-search-id', 'developer')

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('Real Company')
    })
  })

  describe('isJobAggregator', () => {
    it('should identify Indeed as aggregator', () => {
      const result = (manager as any).isJobAggregator('https://www.indeed.com/jobs')
      expect(result).toBe(true)
    })

    it('should identify LinkedIn as aggregator', () => {
      const result = (manager as any).isJobAggregator('https://www.linkedin.com/jobs/search/')
      expect(result).toBe(true)
    })

    it('should not identify company career page as aggregator', () => {
      const result = (manager as any).isJobAggregator('https://techcorp.com/careers')
      expect(result).toBe(false)
    })

    it('should handle invalid URLs gracefully', () => {
      const result = (manager as any).isJobAggregator('not-a-valid-url')
      expect(result).toBe(false)
    })

    it('should be case insensitive', () => {
      const result = (manager as any).isJobAggregator('https://www.INDEED.COM/jobs')
      expect(result).toBe(true)
    })
  })

  describe('extractDomain', () => {
    it('should extract domain from full URL', () => {
      const domain = (manager as any).extractDomain('https://www.example.com/careers')
      expect(domain).toBe('example.com')
    })

    it('should remove www prefix', () => {
      const domain = (manager as any).extractDomain('https://www.techcorp.io')
      expect(domain).toBe('techcorp.io')
    })

    it('should handle URLs without www', () => {
      const domain = (manager as any).extractDomain('https://api.company.com')
      expect(domain).toBe('api.company.com')
    })

    it('should handle invalid URLs gracefully', () => {
      const domain = (manager as any).extractDomain('invalid-url')
      expect(domain).toBe('invalid-url')
    })
  })
})
