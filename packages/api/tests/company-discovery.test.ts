import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock the claude client module FIRST - must be before any imports from company-discovery
vi.mock('../src/claude/client.js')

import { validateAndExtractCompanies, isAggregator, isValidUrl } from '../src/utils/company-discovery'
import * as claudeClient from '../src/claude/client.js'

describe('Company Discovery Utility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  describe('validateAndExtractCompanies', () => {
    it('should extract companies from LLM response', async () => {
      const mockResponse = JSON.stringify({
        companies: [
          { name: 'Google', url: 'https://careers.google.com', location: 'Mountain View, CA' },
          { name: 'Microsoft', url: 'https://careers.microsoft.com', location: 'Redmond, WA' },
        ],
      })

      vi.mocked(claudeClient.callClaude).mockResolvedValue(mockResponse)

      const result = await validateAndExtractCompanies('user123', 'software engineer', [])

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
      const mockResponse = JSON.stringify({
        companies: [
          { name: 'Google', url: 'https://careers.google.com' },
          { name: 'Indeed', url: 'https://indeed.com' }, // aggregator
          { name: 'LinkedIn', url: 'https://linkedin.com/jobs' }, // aggregator
          { name: 'Apple', url: 'https://jobs.apple.com' },
        ],
      })

      vi.mocked(claudeClient.callClaude).mockResolvedValue(mockResponse)

      const result = await validateAndExtractCompanies('user123', 'software engineer', [])

      expect(result).toHaveLength(2)
      expect(result.map((c) => c.name)).toEqual(['Google', 'Apple'])
    })

    it('should validate company URLs are valid before including', async () => {
      const mockResponse = JSON.stringify({
        companies: [
          { name: 'Google', url: 'https://careers.google.com' },
          { name: 'BadCorp', url: 'not-a-valid-url' }, // invalid URL
          { name: 'Microsoft', url: 'https://careers.microsoft.com' },
        ],
      })

      vi.mocked(claudeClient.callClaude).mockResolvedValue(mockResponse)

      const result = await validateAndExtractCompanies('user123', 'software engineer', [])

      expect(result).toHaveLength(2)
      expect(result.map((c) => c.name)).toEqual(['Google', 'Microsoft'])
    })

    it('should handle empty LLM response', async () => {
      vi.mocked(claudeClient.callClaude).mockResolvedValue(JSON.stringify({ companies: [] }))

      const result = await validateAndExtractCompanies('user123', 'software engineer', [])

      expect(result).toHaveLength(0)
      expect(Array.isArray(result)).toBe(true)
    })

    it('should handle malformed JSON from LLM', async () => {
      vi.mocked(claudeClient.callClaude).mockResolvedValue('Not valid JSON at all')

      const result = await validateAndExtractCompanies('user123', 'software engineer', [])

      expect(Array.isArray(result)).toBe(true)
      expect(result).toHaveLength(0)
    })

    it('should require name and url fields on companies', async () => {
      const mockResponse = JSON.stringify({
        companies: [
          { name: 'Google', url: 'https://careers.google.com' },
          { name: 'NoUrl' }, // missing url
          { url: 'https://noname.com' }, // missing name
          { name: 'Apple', url: 'https://jobs.apple.com' },
        ],
      })

      vi.mocked(claudeClient.callClaude).mockResolvedValue(mockResponse)

      const result = await validateAndExtractCompanies('user123', 'software engineer', [])

      expect(result).toHaveLength(2)
      expect(result.map((c) => c.name)).toEqual(['Google', 'Apple'])
    })

    it('should pass search query and search results to Claude', async () => {
      const mockResponse = JSON.stringify({ companies: [] })
      vi.mocked(claudeClient.callClaude).mockResolvedValue(mockResponse)

      const searchResults = [
        { title: 'Job 1', url: 'https://example.com/job1' },
        { title: 'Job 2', url: 'https://example.com/job2' },
      ]

      await validateAndExtractCompanies('user123', 'senior software engineer', searchResults)

      expect(claudeClient.callClaude).toHaveBeenCalledWith('user123', expect.stringContaining('senior software engineer'))
      expect(claudeClient.callClaude).toHaveBeenCalledWith('user123', expect.any(String))
    })

    it('should handle location as optional field', async () => {
      const mockResponse = JSON.stringify({
        companies: [
          { name: 'Google', url: 'https://careers.google.com', location: 'Mountain View' },
          { name: 'Apple', url: 'https://jobs.apple.com', location: 'Cupertino' },
          { name: 'NoLocation', url: 'https://company.example.com' }, // no location
        ],
      })

      vi.mocked(claudeClient.callClaude).mockResolvedValue(mockResponse)

      const result = await validateAndExtractCompanies('user123', 'software engineer', [])

      expect(result).toHaveLength(3)
      expect(result[0].location).toBe('Mountain View')
      expect(result[2].location).toBeUndefined()
    })
  })
})
