// packages/api/src/sources/__tests__/query-parser.test.ts
import { describe, it, expect } from 'vitest'
import { parseJobQuery, expandTitleVariants } from '../query-parser'

describe('parseJobQuery', () => {
  it('splits "<role> in <place>" and normalizes the English city name', () => {
    expect(parseJobQuery('Product Manager in Munich')).toEqual({
      keywords: 'Product Manager',
      location: 'München',
      radius: 25,
    })
  })

  it('splits "<role>, <place>"', () => {
    expect(parseJobQuery('Senior Product Manager, Berlin')).toEqual({
      keywords: 'Senior Product Manager',
      location: 'Berlin',
      radius: 25,
    })
  })

  it('recognizes a known city at the end without a preposition', () => {
    expect(parseJobQuery('Produktmanager München')).toEqual({
      keywords: 'Produktmanager',
      location: 'München',
      radius: 25,
    })
  })

  it('handles German prepositions and transliterated umlauts', () => {
    expect(parseJobQuery('Product Owner bei Muenchen')).toEqual({
      keywords: 'Product Owner',
      location: 'München',
      radius: 25,
    })
  })

  it('keeps an unknown place after "in" as the location', () => {
    expect(parseJobQuery('Product Manager in Ismaning')).toEqual({
      keywords: 'Product Manager',
      location: 'Ismaning',
      radius: 25,
    })
  })

  it('returns the whole query as keywords when there is no location', () => {
    expect(parseJobQuery('Senior Backend Engineer')).toEqual({ keywords: 'Senior Backend Engineer' })
  })

  it('does not split on "in" inside a role phrase without a place', () => {
    expect(parseJobQuery('Product Manager in')).toEqual({ keywords: 'Product Manager in' })
  })

  it('trims whitespace', () => {
    expect(parseJobQuery('  Product Manager   in   Munich  ')).toEqual({
      keywords: 'Product Manager',
      location: 'München',
      radius: 25,
    })
  })
})

describe('expandTitleVariants', () => {
  it('expands a Product Manager query into DE+EN title variants (issue #187)', () => {
    expect(expandTitleVariants('Product Manager')).toEqual([
      'Produktmanager',
      'Product Manager',
      'Product Owner',
      'Senior Product Manager',
      'Technical Product Manager',
    ])
  })

  it('matches case-insensitively, including the German spelling', () => {
    expect(expandTitleVariants('produktmanager')).toEqual(expandTitleVariants('Product Manager'))
    expect(expandTitleVariants('Senior Product Manager')).toEqual(expandTitleVariants('Product Manager'))
  })

  it('expands Product Owner queries into the same family', () => {
    expect(expandTitleVariants('Product Owner')).toEqual(expandTitleVariants('Product Manager'))
  })

  it('returns the keywords unchanged for unknown roles', () => {
    expect(expandTitleVariants('Senior Backend Engineer')).toEqual(['Senior Backend Engineer'])
  })
})
