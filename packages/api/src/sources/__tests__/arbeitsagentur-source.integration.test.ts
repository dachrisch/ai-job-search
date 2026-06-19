// packages/api/src/sources/__tests__/arbeitsagentur-source.integration.test.ts
import { describe, it, expect } from 'vitest'
import { ArbeitsagenturSource } from '../arbeitsagentur-source'

const run = process.env.RUN_INTEGRATION_TESTS === 'true'

describe.skipIf(!run)('ArbeitsagenturSource (live)', () => {
  it('returns real jobs for a common DACH software query', async () => {
    const source = new ArbeitsagenturSource()

    const result = await source.search({
      keywords: 'softwareentwickler',
      location: 'Berlin',
      radius: 50,
      raw: 'softwareentwickler berlin',
    })

    expect(result.errors).toEqual([])
    expect(result.jobs.length).toBeGreaterThan(0)
    const j = result.jobs[0]
    expect(j.title).toBeTruthy()
    expect(j.company).toBeTruthy()
    expect(j.url).toContain('arbeitsagentur.de')
  }, 15000)
})
