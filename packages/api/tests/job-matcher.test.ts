import { describe, it, expect } from 'vitest'
import { calculateKeywordMatch, passesKeywordThreshold, KeywordMatchResult } from '../src/utils/job-matcher'

describe('Job Keyword Matcher', () => {
  describe('calculateKeywordMatch', () => {
    it('matches job title to query with high score for relevant title', () => {
      const result = calculateKeywordMatch('Senior Python Engineer', 'python engineer')

      expect(result).toHaveProperty('score')
      expect(result).toHaveProperty('reasoning')
      expect(result.score).toBeGreaterThan(0.7)
      expect(result.score).toBeLessThanOrEqual(1)
    })

    it('gives lower score for partial matches with unrelated keywords', () => {
      const result = calculateKeywordMatch('Senior Java Developer', 'python engineer')

      expect(result.score).toBeLessThan(0.5)
      expect(result.score).toBeGreaterThanOrEqual(0)
    })

    it('matches multiple keywords with high score', () => {
      const result = calculateKeywordMatch(
        'Senior Backend Python Engineer - Remote',
        'backend python engineer remote'
      )

      expect(result.score).toBeGreaterThan(0.8)
    })

    it('handles case insensitivity correctly', () => {
      const result1 = calculateKeywordMatch('Senior Python Engineer', 'python engineer')
      const result2 = calculateKeywordMatch('senior python engineer', 'PYTHON ENGINEER')
      const result3 = calculateKeywordMatch('SENIOR PYTHON ENGINEER', 'Python Engineer')

      expect(result1.score).toBe(result2.score)
      expect(result2.score).toBe(result3.score)
    })

    it('matches with description text when provided', () => {
      const result = calculateKeywordMatch(
        'Senior Java Developer',
        'python',
        'We are looking for a Python expert with 5+ years of experience'
      )

      expect(result.score).toBeGreaterThan(0.2)
      expect(result.reasoning).toContain('Title')
      expect(result.reasoning).toContain('Description')
    })

    it('returns reasoning string describing the match', () => {
      const result = calculateKeywordMatch('Senior Python Engineer', 'python engineer')

      expect(result.reasoning).toBeDefined()
      expect(typeof result.reasoning).toBe('string')
      expect(result.reasoning.length).toBeGreaterThan(0)
      expect(result.reasoning).toMatch(/\d+%/)
    })

    it('returns score between 0 and 1 inclusive', () => {
      const testCases = [
        { title: 'Python Engineer', query: 'python' },
        { title: 'Java Developer', query: 'python' },
        { title: 'Senior Backend Python Engineer - Remote', query: 'backend python engineer' },
        { title: 'Random Title', query: 'xyz abc def' }
      ]

      testCases.forEach(testCase => {
        const result = calculateKeywordMatch(testCase.title, testCase.query)
        expect(result.score).toBeGreaterThanOrEqual(0)
        expect(result.score).toBeLessThanOrEqual(1)
      })
    })

    it('returns exact match score of 1.0 for identical strings', () => {
      const result = calculateKeywordMatch('python engineer', 'python engineer')

      expect(result.score).toBe(1.0)
      expect(result.reasoning).toContain('100%')
    })

    it('returns substring match score of 0.8 when query is substring of title', () => {
      const result = calculateKeywordMatch('Senior Python Engineer', 'python engineer')

      // "python engineer" is a substring of "senior python engineer"
      expect(result.score).toBe(0.8)
    })

    it('calculates word-level matching correctly', () => {
      // "backend" and "python" are present (2/3 = 0.67 * 0.9 ≈ 0.6)
      const result = calculateKeywordMatch('Backend Python Developer', 'backend python engineer')

      expect(result.score).toBeGreaterThan(0.5)
      expect(result.score).toBeLessThan(0.9)
    })

    it('weights title 70% and description 30% when both provided', () => {
      // Title score should be higher than combined score with description
      const titleScore = calculateKeywordMatch('Python Engineer', 'python').score
      const combinedScore = calculateKeywordMatch(
        'Python Engineer',
        'python',
        'Java and C++ expert'
      ).score

      expect(combinedScore).toBeLessThan(titleScore)
    })

    it('rounds score to 2 decimal places', () => {
      const result = calculateKeywordMatch('Backend Python Developer', 'backend python')

      const decimalPlaces = (result.score.toString().split('.')[1] || '').length
      expect(decimalPlaces).toBeLessThanOrEqual(2)
    })

    it('handles empty query gracefully', () => {
      const result = calculateKeywordMatch('Python Engineer', '')

      expect(result.score).toBeGreaterThanOrEqual(0)
      expect(result.score).toBeLessThanOrEqual(1)
      expect(result.reasoning).toBeDefined()
    })

    it('handles empty title gracefully', () => {
      const result = calculateKeywordMatch('', 'python engineer')

      expect(result.score).toBeGreaterThanOrEqual(0)
      expect(result.score).toBeLessThanOrEqual(1)
      expect(result.reasoning).toBeDefined()
    })

    it('handles whitespace trimming correctly', () => {
      const result1 = calculateKeywordMatch('  Python Engineer  ', '  python  ')
      const result2 = calculateKeywordMatch('Python Engineer', 'python')

      expect(result1.score).toBe(result2.score)
    })
  })

  describe('passesKeywordThreshold', () => {
    it('returns true when score meets default threshold of 0.4', () => {
      expect(passesKeywordThreshold(0.4)).toBe(true)
      expect(passesKeywordThreshold(0.5)).toBe(true)
      expect(passesKeywordThreshold(1.0)).toBe(true)
    })

    it('returns false when score is below default threshold of 0.4', () => {
      expect(passesKeywordThreshold(0.3)).toBe(false)
      expect(passesKeywordThreshold(0)).toBe(false)
    })

    it('returns true when score meets custom threshold', () => {
      expect(passesKeywordThreshold(0.7, 0.6)).toBe(true)
      expect(passesKeywordThreshold(0.6, 0.6)).toBe(true)
    })

    it('returns false when score is below custom threshold', () => {
      expect(passesKeywordThreshold(0.5, 0.6)).toBe(false)
      expect(passesKeywordThreshold(0.3, 0.5)).toBe(false)
    })

    it('returns false for zero score with default threshold', () => {
      expect(passesKeywordThreshold(0)).toBe(false)
    })

    it('returns true for perfect score', () => {
      expect(passesKeywordThreshold(1.0)).toBe(true)
      expect(passesKeywordThreshold(1.0, 0.9)).toBe(true)
    })
  })

  describe('KeywordMatchResult interface', () => {
    it('has required properties score and reasoning', () => {
      const result = calculateKeywordMatch('Python Engineer', 'python')

      expect(result).toHaveProperty('score')
      expect(result).toHaveProperty('reasoning')
      expect(typeof result.score).toBe('number')
      expect(typeof result.reasoning).toBe('string')
    })
  })
})
