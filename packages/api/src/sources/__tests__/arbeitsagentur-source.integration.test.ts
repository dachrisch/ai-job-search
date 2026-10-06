// packages/api/src/sources/__tests__/arbeitsagentur-source.integration.test.ts
import { describe, it, expect } from 'vitest'
import { ArbeitsagenturSource } from '../arbeitsagentur-source'

const run = process.env.RUN_INTEGRATION_TESTS === 'true'

describe.skipIf(!run)('ArbeitsagenturSource (live)', () => {
  it('returns real jobs from the v6 API for a location-scoped query', async () => {
    const source = new ArbeitsagenturSource()

    const result = await source.search({
      keywords: 'Product Manager',
      location: 'München',
      radius: 25,
      raw: 'Product Manager in Munich',
    })

    expect(result.errors).toEqual([])
    expect(result.jobs.length).toBeGreaterThan(0)
    const j = result.jobs[0]
    expect(j.title).toBeTruthy()
    expect(j.company).toBeTruthy()
    expect(j.url).toContain('arbeitsagentur.de/jobsuche/jobdetail/')
  }, 15000)
})
