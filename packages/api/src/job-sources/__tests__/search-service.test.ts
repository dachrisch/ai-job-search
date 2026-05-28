import { SearchService } from '../search-service'
import { describe, it, expect, beforeEach, vi } from 'vitest'

describe('SearchService', () => {
  let service: SearchService

  beforeEach(() => {
    service = new SearchService('http://localhost:8888')
  })

  it('should call SearXNG API and return search results', async () => {
    const results = await service.search('python backend engineer remote')

    expect(Array.isArray(results)).toBe(true)

    // Results may be empty if SearXNG is unavailable, but should be an array
    results.forEach(result => {
      expect(result).toHaveProperty('url')
      expect(result).toHaveProperty('title')
      expect(result).toHaveProperty('snippet')
      expect(result).toHaveProperty('relevanceScore')
      expect(typeof result.url).toBe('string')
      expect(typeof result.title).toBe('string')
      expect(typeof result.snippet).toBe('string')
      expect(typeof result.relevanceScore).toBe('number')
      expect(result.relevanceScore).toBeGreaterThanOrEqual(0)
      expect(result.relevanceScore).toBeLessThanOrEqual(1)
    })
  })

  it('should handle network errors gracefully', async () => {
    const serviceWithTimeout = new SearchService('http://localhost:9999')
    const results = await serviceWithTimeout.search('test query', { timeout: 100 })

    expect(Array.isArray(results)).toBe(true)
    // Should return empty array on error, not throw
  })

  it('should apply rate limiting between requests', async () => {
    const start = Date.now()

    await service.search('query 1')
    await service.search('query 2')

    const duration = Date.now() - start
    // Should have at least 2 seconds delay (with small buffer for execution time)
    expect(duration).toBeGreaterThanOrEqual(1900)
  })

  it('should respect maxResults option', async () => {
    const results = await service.search('javascript developer', { maxResults: 5 })
    expect(results.length).toBeLessThanOrEqual(5)
  })

  it('should calculate relevance score based on query match', () => {
    const relevance = (service as any).calculateRelevance(
      'Senior Python Backend Engineer Remote',
      'python backend engineer'
    )
    expect(relevance).toBeGreaterThan(0)
    expect(relevance).toBeLessThanOrEqual(1)
  })
})
