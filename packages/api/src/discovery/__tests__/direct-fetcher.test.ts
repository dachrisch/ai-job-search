import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { get, extractArray, buildParams } from '../direct-fetcher.js'

describe('get', () => {
  it('resolves shallow path', () => {
    expect(get({ title: 'Engineer' }, 'title')).toBe('Engineer')
  })

  it('resolves nested dot path', () => {
    expect(get({ primaryLocation: { city: 'Berlin' } }, 'primaryLocation.city')).toBe('Berlin')
  })

  it('returns empty string for missing key', () => {
    expect(get({ a: 1 }, 'b')).toBe('')
  })

  it('returns empty string for empty path', () => {
    expect(get({ a: 1 }, '')).toBe('')
  })

  it('returns empty string when intermediate key missing', () => {
    expect(get({ a: {} }, 'a.b.c')).toBe('')
  })
})

describe('extractArray', () => {
  it('returns top-level array directly', () => {
    const arr = [{ id: 1 }, { id: 2 }]
    expect(extractArray(arr)).toBe(arr)
  })

  it('finds jobs key', () => {
    const jobs = [{ id: 1 }]
    expect(extractArray({ jobs })).toBe(jobs)
  })

  it('finds postings key', () => {
    const postings = [{ id: 1 }]
    expect(extractArray({ postings })).toBe(postings)
  })

  it('finds data key', () => {
    const data = [{ id: 1 }]
    expect(extractArray({ meta: 'x', data })).toBe(data)
  })

  it('falls back to first array value when no known key', () => {
    const items = [{ id: 1 }]
    expect(extractArray({ unknownKey: items })).toBe(items)
  })

  it('returns empty array when no array found', () => {
    expect(extractArray({ foo: 'bar' })).toEqual([])
  })
})

describe('buildParams', () => {
  it('replaces {keywords} placeholder', () => {
    const result = buildParams({ q: '{keywords}', limit: 20 }, 'python engineer')
    expect(result).toEqual({ q: 'python engineer', limit: '20' })
  })

  it('leaves non-placeholder values unchanged', () => {
    const result = buildParams({ limit: 50, offset: 0 }, 'anything')
    expect(result).toEqual({ limit: '50', offset: '0' })
  })

  it('handles empty template', () => {
    expect(buildParams({}, 'query')).toEqual({})
  })
})

import { fetchFromDiscoveredApi } from '../direct-fetcher.js'
import type { DiscoveredApiConfig } from '@job-search/shared'

const CONFIG: DiscoveredApiConfig = {
  endpoint: 'https://example.com/api/jobs',
  method: 'GET',
  paramTemplate: { q: '{keywords}', limit: 10 },
  fieldMapping: { title: 'requisitionTitle', url: 'externalUrl', location: 'city', description: 'summary' },
  discoveredAt: new Date(),
}

describe('fetchFromDiscoveredApi', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fetches, maps fields, and drops short titles', async () => {
    const mockData = {
      jobs: [
        { requisitionTitle: 'Senior Engineer', externalUrl: 'https://example.com/jobs/1', city: 'Berlin', summary: 'Great role.' },
        { requisitionTitle: 'Dev', externalUrl: 'https://example.com/jobs/2', city: 'Remote', summary: 'Short.' },
      ],
    }
    ;(global.fetch as any).mockResolvedValue({ ok: true, json: async () => mockData })

    const jobs = await fetchFromDiscoveredApi(CONFIG, 'engineer', 'Acme', 'https://acme.com/careers')

    expect(jobs).toHaveLength(1)
    expect(jobs[0].title).toBe('Senior Engineer')
    expect(jobs[0].company).toBe('Acme')
    expect(jobs[0].location).toBe('Berlin')
    expect(jobs[0].sourceUrl).toBe('https://acme.com/careers')
  })

  it('throws on non-ok HTTP response', async () => {
    ;(global.fetch as any).mockResolvedValue({ ok: false, status: 403 })
    await expect(
      fetchFromDiscoveredApi(CONFIG, 'query', 'Acme', 'https://acme.com/careers')
    ).rejects.toThrow('HTTP 403')
  })

  it('injects keywords into query params', async () => {
    ;(global.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ jobs: [] }) })
    await fetchFromDiscoveredApi(CONFIG, 'python developer', 'Acme', 'https://acme.com/careers')
    const calledUrl = (global.fetch as any).mock.calls[0][0] as string
    expect(calledUrl).toContain('q=python+developer')
  })
})
