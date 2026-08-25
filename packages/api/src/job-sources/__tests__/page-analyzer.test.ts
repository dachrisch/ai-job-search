import { describe, it, expect, beforeEach, vi } from 'vitest'
import { PageAnalyzer } from '../page-analyzer'
import { SearchResult } from '../interfaces'

vi.mock('../../ai/llm.js')

import { callLLMJson } from '../../ai/llm.js'

describe('PageAnalyzer', () => {
  const analyzer = new PageAnalyzer()

  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('should analyze search results and prioritize job boards', async () => {
    const results: SearchResult[] = [
      {
        url: 'https://linkedin.com/jobs',
        title: 'LinkedIn Jobs - Find Your Next Opportunity',
        snippet: 'Search job listings on LinkedIn',
        relevanceScore: 0.9
      },
      {
        url: 'https://example.com/blog',
        title: 'How to Write a Resume',
        snippet: 'Tips for writing a great resume',
        relevanceScore: 0.2
      }
    ]

    vi.mocked(callLLMJson).mockResolvedValue([
      { urlIndex: 1, confidence: 0.95, priority: 9, reason: 'Job board' },
      { urlIndex: 2, confidence: 0.1, priority: 2, reason: 'Blog post' }
    ])

    const analyzed = await analyzer.analyzePages(results, 'python backend engineer')

    expect(Array.isArray(analyzed)).toBe(true)
    expect(analyzed.length).toBeGreaterThan(0)
    expect(analyzed[0].url).toContain('linkedin.com')

    analyzed.forEach(page => {
      expect(page).toHaveProperty('url')
      expect(page).toHaveProperty('confidence')
      expect(page).toHaveProperty('reason')
      expect(page).toHaveProperty('priority')
      expect(page.confidence).toBeGreaterThanOrEqual(0)
      expect(page.confidence).toBeLessThanOrEqual(1)
    })
  })

  it('should fall back to heuristic analysis when opencode fails', async () => {
    const results: SearchResult[] = [
      {
        url: 'https://example.com',
        title: 'Test Page',
        snippet: 'Test snippet',
        relevanceScore: 0.5
      }
    ]

    vi.mocked(callLLMJson).mockRejectedValue(new Error('opencode unavailable'))

    const analyzed = await analyzer.analyzePages(results, 'test query')

    expect(analyzed.length).toBeGreaterThan(0)
    expect(analyzed[0].confidence).toBeGreaterThan(0)
  })
})