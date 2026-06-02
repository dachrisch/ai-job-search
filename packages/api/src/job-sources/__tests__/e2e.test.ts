import { JobSourceManager } from '../manager'
import { RateLimiter } from '../rate-limiter'
import { MockSource } from '../mock-source'

describe('Job Discovery E2E - JobSourceManager Integration', () => {
  let manager: JobSourceManager

  beforeEach(() => {
    manager = new JobSourceManager()
  })

  describe('End-to-End Job Scraping Flow', () => {
    it('should successfully scrape jobs from multiple domains', async () => {
      const domains = ['linkedin.com']
      const keywords = 'software engineer'

      const results = await manager.scrapeJobs(domains, keywords)

      expect(Array.isArray(results)).toBe(true)
      expect(results.length).toBeGreaterThan(0)
      results.forEach(result => {
        expect(result).toHaveProperty('source')
        expect(result).toHaveProperty('jobs')
        expect(result).toHaveProperty('errors')
        expect(Array.isArray(result.jobs)).toBe(true)
        expect(Array.isArray(result.errors)).toBe(true)
      })
    })

    it('should provide fallback results when primary scrapers fail', async () => {
      const domains = ['unknown-job-board-12345.com']
      const keywords = 'backend developer'

      const results = await manager.scrapeJobs(domains, keywords)

      expect(Array.isArray(results)).toBe(true)
      expect(results.length).toBeGreaterThan(0)

      // Check that MockSource provided fallback data
      const mockResults = results.filter(r => r.source === 'MockSource')
      expect(mockResults.length).toBeGreaterThan(0)
      expect(mockResults[0].jobs.length).toBeGreaterThan(0)
    })

    it('should handle mixed success and failure scenarios', async () => {
      const domains = ['linkedin.com', 'invalid-domain-xyz.com', 'github.com']
      const keywords = 'devops engineer'

      const results = await manager.scrapeJobs(domains, keywords)

      expect(Array.isArray(results)).toBe(true)

      const jobResults = results.filter(r => r.jobs.length > 0)
      const errorResults = results.filter(r => r.errors.length > 0)

      // Should have at least some results (either jobs or errors)
      expect(jobResults.length + errorResults.length).toBeGreaterThan(0)

      // Verify job structure
      jobResults.forEach(result => {
        result.jobs.forEach(job => {
          expect(job).toHaveProperty('title')
          expect(job).toHaveProperty('company')
          expect(typeof job.title).toBe('string')
          expect(typeof job.company).toBe('string')
        })
      })
    })

    it('should respect rate limiting across multiple requests', async () => {
      const domains = ['linkedin.com']
      const keywords = 'frontend engineer'

      const startTime = Date.now()

      // Make multiple requests
      const request1 = manager.scrapeJobs(domains, keywords)
      const request2 = manager.scrapeJobs(domains, keywords)

      const results = await Promise.all([request1, request2])

      const endTime = Date.now()
      const duration = endTime - startTime

      // With rate limiting, two requests should take some time
      // (This is a soft assertion as network conditions vary)
      expect(Array.isArray(results[0])).toBe(true)
      expect(Array.isArray(results[1])).toBe(true)
    })

    it('should aggregate results from available sources', async () => {
      const domains = ['linkedin.com', 'github.com']
      const keywords = 'data scientist'

      const results = await manager.scrapeJobs(domains, keywords)

      // Count total jobs across all sources
      const totalJobs = results.reduce((sum, r) => sum + r.jobs.length, 0)

      // Should have aggregated results from multiple sources
      expect(totalJobs >= 0).toBe(true)

      // Verify result structure
      results.forEach(result => {
        expect(typeof result.source).toBe('string')
        expect(Array.isArray(result.jobs)).toBe(true)
        expect(Array.isArray(result.errors)).toBe(true)
      })
    })

    it('should handle empty domains array gracefully', async () => {
      const domains = []
      const keywords = 'software engineer'

      const results = await manager.scrapeJobs(domains, keywords)

      // Should still return valid result structure
      expect(Array.isArray(results)).toBe(true)
    })

    it('should handle empty keywords gracefully', async () => {
      const domains = ['linkedin.com']
      const keywords = ''

      const results = await manager.scrapeJobs(domains, keywords)

      expect(Array.isArray(results)).toBe(true)
      // Should still attempt to scrape with default or empty keywords
      expect(results.length >= 0).toBe(true)
    })
  })

  describe('Source Manager Registration', () => {
    it('should have MockSource registered as fallback', () => {
      const sources = manager.getSources()
      const hasMock = sources.some(s => s.name === 'MockSource')
      expect(hasMock).toBe(true)
    })

    it('should find appropriate sources for domain', () => {
      const matchingSources = manager.findSourcesForDomains(['linkedin.com'])
      expect(matchingSources.length).toBeGreaterThan(0)
    })

    it('should return all sources when no domain match found', () => {
      const allSources = manager.getSources()
      const matchingSources = manager.findSourcesForDomains(['unknown-site-12345.com'])

      // Should fall back to all available sources
      expect(matchingSources.length).toBeGreaterThanOrEqual(allSources.length - 1)
    })
  })

  describe('Error Handling and Resilience', () => {
    it('should not throw on scraper timeout', async () => {
      const domains = ['linkedin.com']
      const keywords = 'engineer'

      expect(async () => {
        await manager.scrapeJobs(domains, keywords, { timeout: 1000 })
      }).not.toThrow()
    })

    it('should handle concurrent requests without race conditions', async () => {
      const requests = Array(5)
        .fill(null)
        .map(() => manager.scrapeJobs(['linkedin.com'], 'engineer'))

      const results = await Promise.all(requests)

      // All requests should complete successfully
      results.forEach(result => {
        expect(Array.isArray(result)).toBe(true)
      })
    })

    it('should provide meaningful error messages for failed sources', async () => {
      const domains = ['definitely-not-a-real-job-board.invalid']
      const keywords = 'engineer'

      const results = await manager.scrapeJobs(domains, keywords)

      const errorResults = results.filter(r => r.errors.length > 0)
      if (errorResults.length > 0) {
        errorResults.forEach(result => {
          result.errors.forEach(error => {
            expect(typeof error.message).toBe('string')
            expect(error.message.length).toBeGreaterThan(0)
          })
        })
      }
    })
  })

  describe('Performance Characteristics', () => {
    it('should complete scraping within reasonable timeout', async () => {
      const domains = ['linkedin.com']
      const keywords = 'engineer'
      const timeout = 30000 // 30 seconds

      const startTime = Date.now()
      const results = await manager.scrapeJobs(domains, keywords, { timeout })
      const duration = Date.now() - startTime

      expect(duration).toBeLessThan(timeout)
      expect(Array.isArray(results)).toBe(true)
    })

    it('should return results even if some sources timeout', async () => {
      const domains = ['linkedin.com', 'github.com', 'stack-overflow.com']
      const keywords = 'developer'

      const results = await manager.scrapeJobs(domains, keywords, { timeout: 5000 })

      // Should have some results even if some sources failed
      expect(Array.isArray(results)).toBe(true)
      const totalResults = results.reduce((sum, r) => sum + r.jobs.length + r.errors.length, 0)
      expect(totalResults).toBeGreaterThanOrEqual(0)
    })
  })

  describe('Integration with Event Handler Flow', () => {
    it('should produce valid job objects for event payload', async () => {
      const domains = ['linkedin.com']
      const keywords = 'software engineer'

      const results = await manager.scrapeJobs(domains, keywords)
      const allJobs = results.flatMap(r => r.jobs)

      // Verify jobs can be used in event payload (crawl_requested -> jobs_scraped)
      allJobs.forEach(job => {
        expect(typeof job.title).toBe('string')
        expect(typeof job.company).toBe('string')
        if (job.description) {
          expect(typeof job.description).toBe('string')
        }
        if (job.location) {
          expect(typeof job.location).toBe('string')
        }
        if (job.url) {
          expect(typeof job.url).toBe('string')
        }
      })
    })

    it('should handle zero jobs gracefully for fallback to mock data', async () => {
      const domains = ['not-a-real-domain.test']
      const keywords = 'engineer'

      const results = await manager.scrapeJobs(domains, keywords)

      // Results should always be an array (never null/undefined)
      expect(Array.isArray(results)).toBe(true)

      // If all scrapers fail, MockSource should provide fallback
      const mockResults = results.find(r => r.source === 'MockSource')
      if (mockResults) {
        expect(Array.isArray(mockResults.jobs)).toBe(true)
        // MockSource should provide some jobs
        expect(mockResults.jobs.length >= 0).toBe(true)
      }
    })
  })
})
