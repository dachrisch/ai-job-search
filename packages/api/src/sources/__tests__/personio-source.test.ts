import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

vi.mock('axios', () => ({ default: { get: vi.fn() } }))

let PersonioSource: typeof import('../personio-source')['PersonioSource']
let axios: typeof import('axios')['default']

describe('PersonioSource', () => {
  let source: InstanceType<typeof PersonioSource>

  beforeEach(async () => {
    vi.resetModules()
    ;({ PersonioSource } = await import('../personio-source'))
    axios = (await import('axios')).default
    vi.clearAllMocks()
    source = new PersonioSource('1komma5grad')
  })

  it('parses the XML fixture into SourceJobs', async () => {
    const fixture = fs.readFileSync(path.join(__dirname, 'personio-fixture.xml'), 'utf8')
    vi.mocked(axios.get).mockResolvedValue({ data: fixture } as any)

    // ENABLE_TIER3 must be true for results to come back
    const original = process.env.ENABLE_TIER3
    process.env.ENABLE_TIER3 = 'true'

    try {
      const result = await source.search({ keywords: 'SEO', raw: 'SEO' })
      expect(result.source).toBe('personio')
      expect(result.errors).toEqual([])
      expect(result.jobs.length).toBeGreaterThanOrEqual(2)

      const first = result.jobs[0]
      expect(first.title).toBe('(Junior) SEO & AI Marketing Manager (m/w/d)')
      expect(first.company).toBe('1KOMMA5° GmbH')
      expect(first.location).toBe('Berlin')
      expect(first.url).toContain('2800938')
      expect(first.sourceUrl).toBe('https://1komma5grad.jobs.personio.de/')
      expect(first.publishedAt).toContain('2026-09-17')
      expect(first.remote).toBe('full') // Berlin (Remote) in additionalOffices
    } finally {
      process.env.ENABLE_TIER3 = original
    }
  })

  it('returns empty when ENABLE_TIER3 is disabled', async () => {
    const original = process.env.ENABLE_TIER3
    process.env.ENABLE_TIER3 = ''
    try {
      const result = await source.search({ keywords: 'test', raw: 'test' })
      expect(result.jobs).toEqual([])
      expect(result.errors).toEqual([])
    } finally {
      process.env.ENABLE_TIER3 = original
    }
  })
})
