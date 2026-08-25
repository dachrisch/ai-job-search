import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock the LLM facade module FIRST - must be before any imports from company-discovery
vi.mock('../src/ai/llm.js')

import { validateAndExtractCompanies, isAggregator, isValidUrl } from '../src/utils/company-discovery'
import * as llm from '../src/ai/llm.js'

describe('Company Discovery Utility', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  describe('isAggregator', () => {
    it('should identify known job aggregators', () => {
      const aggregators = [
        'https://www.indeed.com/jobs',
        'https://linkedin.com/jobs',
        'https://www.glassdoor.com/Jobs',
        'https://dice.com/jobs',
        'https://www.builtin.com/jobs',
        'https://monster.com/jobs',
        'https://www.careerbuilder.com/jobs',
        'https://ziprecruiter.com/Jobs',
        'https://flexjobs.com/jobs',
        'https://www.weworkremotely.com/remote-jobs',
        'https://remote.co/remote-jobs',
        'https://snagajob.com/jobs',
      ]

      aggregators.forEach((url) => {
        expect(isAggregator(url)).toBe(true)
      })
    })

    it('should not identify company career pages as aggregators', () => {
      const companyPages = [
        'https://careers.google.com',
        'https://www.microsoft.com/careers',
        'https://jobs.apple.com',
        'https://amazon.jobs',
        'https://www.tesla.com/careers',
      ]

      companyPages.forEach((url) => {
        expect(isAggregator(url)).toBe(false)
      })
    })
  })

  describe('isValidUrl', () => {
    it('should validate correct URLs', () => {
      const validUrls = [
        'https://careers.google.com',
        'http://example.com',
        'https://www.example.com/careers',
        'https://example.com:8080/path?query=value',
      ]

      validUrls.forEach((url) => {
        expect(isValidUrl(url)).toBe(true)
      })
    })

    it('should reject invalid URLs', () => {
      const invalidUrls = ['not-a-url', 'htp://example.com', 'example.com', '', 'javascript:alert(1)']

      invalidUrls.forEach((url) => {
        expect(isValidUrl(url)).toBe(false)
      })
    })
  })

  describe.skipIf(process.env.CI === 'true')('validateAndExtractCompanies', () => {
    it('should extract companies from LLM response', async () => {
      const mockResponse = {
        companies: [
          { name: 'Google', url: 'https://careers.google.com', location: 'Mountain View, CA' },
          { name: 'Microsoft', url: 'https://careers.microsoft.com', location: 'Redmond, WA' },
        ],
      }

      vi.mocked(llm.callLLMJson).mockResolvedValue(mockResponse as any)

      const result = await validateAndExtractCompanies('software engineer', [])

      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({
        name: 'Google',
        url: 'https://careers.google.com',
        location: 'Mountain View, CA',
      })
      expect(result[1]).toEqual({
        name: 'Microsoft',
        url: 'https://careers.microsoft.com',
        location: 'Redmond, WA',
      })
    })

    it('should filter out job aggregators from results', async () => {
      const mockResponse = {
        companies: [
          { name: 'Google', url: 'https://careers.google.com' },
          { name: 'Indeed', url: 'https://indeed.com' }, // aggregator
          { name: 'LinkedIn', url: 'https://linkedin.com/jobs' }, // aggregator
          { name: 'Apple', url: 'https://jobs.apple.com' },
        ],
      }

      vi.mocked(llm.callLLMJson).mockResolvedValue(mockResponse as any)

      const result = await validateAndExtractCompanies('software engineer', [])

      expect(result).toHaveLength(2)
      expect(result.map((c) => c.name)).toEqual(['Google', 'Apple'])
    })

    it('should validate company URLs are valid before including', async () => {
      const mockResponse = {
        companies: [
          { name: 'Google', url: 'https://careers.google.com' },
          { name: 'BadCorp', url: 'not-a-valid-url' }, // invalid URL
          { name: 'Microsoft', url: 'https://careers.microsoft.com' },
        ],
      }

      vi.mocked(llm.callLLMJson).mockResolvedValue(mockResponse as any)

      const result = await validateAndExtractCompanies('software engineer', [])

      expect(result).toHaveLength(2)
      expect(result.map((c) => c.name)).toEqual(['Google', 'Microsoft'])
    })

    it('should handle empty LLM response', async () => {
      vi.mocked(llm.callLLMJson).mockResolvedValue({ companies: [] } as any)

      const result = await validateAndExtractCompanies('software engineer', [])

      expect(result).toHaveLength(0)
      expect(Array.isArray(result)).toBe(true)
    })

    it('should handle malformed LLM response', async () => {
      vi.mocked(llm.callLLMJson).mockResolvedValue({} as any)

      const result = await validateAndExtractCompanies('software engineer', [])

      expect(Array.isArray(result)).toBe(true)
      expect(result).toHaveLength(0)
    })

    it('should require name and url fields on companies', async () => {
      const mockResponse = {
        companies: [
          { name: 'Google', url: 'https://careers.google.com' },
          { name: 'NoUrl' }, // missing url
          { url: 'https://noname.com' }, // missing name
          { name: 'Apple', url: 'https://jobs.apple.com' },
        ],
      }

      vi.mocked(llm.callLLMJson).mockResolvedValue(mockResponse as any)

      const result = await validateAndExtractCompanies('software engineer', [])

      expect(result).toHaveLength(2)
      expect(result.map((c) => c.name)).toEqual(['Google', 'Apple'])
    })

    it('should pass search query and search results to opencode', async () => {
      const mockResponse = { companies: [] }
      vi.mocked(llm.callLLMJson).mockResolvedValue(mockResponse)

      const searchResults = [
        { title: 'Job 1', url: 'https://example.com/job1' },
        { title: 'Job 2', url: 'https://example.com/job2' },
      ]

      await validateAndExtractCompanies('senior software engineer', searchResults)

      expect(llm.callLLMJson).toHaveBeenCalledWith(expect.stringContaining('senior software engineer'))
      expect(llm.callLLMJson).toHaveBeenCalledWith(expect.any(String))
    })

    it('should handle location as optional field', async () => {
      const mockResponse = {
        companies: [
          { name: 'Google', url: 'https://careers.google.com', location: 'Mountain View' },
          { name: 'Apple', url: 'https://jobs.apple.com', location: 'Cupertino' },
          { name: 'NoLocation', url: 'https://company.example.com' }, // no location
        ],
      }

      vi.mocked(llm.callLLMJson).mockResolvedValue(mockResponse as any)

      const result = await validateAndExtractCompanies('software engineer', [])

      expect(result).toHaveLength(3)
      expect(result[0].location).toBe('Mountain View')
      expect(result[2].location).toBeUndefined()
    })
  })
})
