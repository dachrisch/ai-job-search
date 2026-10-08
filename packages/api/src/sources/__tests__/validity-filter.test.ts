// packages/api/src/sources/__tests__/validity-filter.test.ts
import { describe, it, expect } from 'vitest'
import { filterValidJobs } from '../validity-filter'
import { SourceJob } from '../types'

function job(over: Partial<SourceJob> = {}): SourceJob {
  return {
    title: 'Product Manager (m/w/d)',
    company: 'Edenred Deutschland GmbH',
    description: 'Build product.',
    url: 'https://www.arbeitsagentur.de/jobsuche/jobdetail/1-S',
    location: 'München',
    sourceUrl: 'https://www.arbeitsagentur.de/jobsuche/',
    publishedAt: '2026-09-22',
    ...over,
  }
}

describe('filterValidJobs (issue #187)', () => {
  it('keeps fresh, unique, legitimate jobs', () => {
    const { valid, rejected } = filterValidJobs([job(), job({ url: 'http://x/2-S', title: 'Product Owner', company: 'BMW' })])
    expect(valid).toHaveLength(2)
    expect(rejected).toEqual([])
  })

  it('drops postings first published more than 6 months ago', () => {
    const { valid, rejected } = filterValidJobs([job({ publishedAt: '2024-03-01' }), job()])
    expect(valid).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0].reason).toBe('stale')
  })

  it('keeps jobs without a publication date', () => {
    const { valid } = filterValidJobs([job({ publishedAt: undefined })])
    expect(valid).toHaveLength(1)
  })

  it('dedupes reposts by normalized title + company', () => {
    const dupe = job({ url: 'http://x/9-S', title: '  product manager (M/W/D) ', company: 'edenred deutschland gmbh' })
    const { valid, rejected } = filterValidJobs([job(), dupe])
    expect(valid).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0].reason).toBe('duplicate')
  })

  it('blocks training providers such as alfatraining', () => {
    const { valid, rejected } = filterValidJobs([job({ company: 'alfatraining Bildungszentrum GmbH' }), job()])
    expect(valid).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0].reason).toBe('blocklisted')
  })

  it('keeps agency suspects but flags them for review instead of dropping', () => {
    const agency = job({ company: 'Randstad Personalberatung', description: 'Zeitarbeit im Kundenauftrag.' })
    const { valid, rejected, flagged } = filterValidJobs([agency])
    expect(valid).toHaveLength(1)
    expect(rejected).toEqual([])
    expect(flagged).toHaveLength(1)
  })
})
