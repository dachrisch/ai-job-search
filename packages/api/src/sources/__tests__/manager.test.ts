// packages/api/src/sources/__tests__/manager.test.ts
import { describe, it, expect } from 'vitest'
import { SourceManager } from '../manager'
import { JobSource, JobQuery, SourceResult, SourceJob } from '../types'

function job(url: string, title = 'Dev'): SourceJob {
  return { title, company: 'C', description: 'd', url, location: 'Berlin', sourceUrl: 's' }
}

class StubSource implements JobSource {
  tier = 1 as const
  constructor(public name: string, private result: SourceResult | Error) {}
  async search(_q: JobQuery): Promise<SourceResult> {
    if (this.result instanceof Error) throw this.result
    return this.result
  }
}

const query: JobQuery = { keywords: 'dev', raw: 'dev' }

describe('SourceManager', () => {
  it('merges jobs from all sources', async () => {
    const a = new StubSource('a', { source: 'a', jobs: [job('https://x.de/1')], errors: [] })
    const b = new StubSource('b', { source: 'b', jobs: [job('https://x.de/2')], errors: [] })
    const mgr = new SourceManager([a, b])

    const result = await mgr.search(query)

    expect(result.jobs).toHaveLength(2)
  })

  it('dedupes by normalized URL (case + trailing slash insensitive)', async () => {
    const a = new StubSource('a', { source: 'a', jobs: [job('https://X.de/JobA/')], errors: [] })
    const b = new StubSource('b', { source: 'b', jobs: [job('https://x.de/joba')], errors: [] })
    const mgr = new SourceManager([a, b])

    const result = await mgr.search(query)

    expect(result.jobs).toHaveLength(1)
  })

  it('isolates a failing source: others still return, failure recorded', async () => {
    const a = new StubSource('a', new Error('boom'))
    const b = new StubSource('b', { source: 'b', jobs: [job('https://x.de/2')], errors: [] })
    const mgr = new SourceManager([a, b])

    const result = await mgr.search(query)

    expect(result.jobs).toHaveLength(1)
    expect(result.errors.some((e) => e.message.includes('boom'))).toBe(true)
  })
})
