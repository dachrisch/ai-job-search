import { describe, it, expect, vi, beforeEach } from 'vitest'

// Robust mocking under vitest's `isolate: false`: another test file calls
// `vi.resetModules()`, which wipes the shared module registry mid-run. With static
// imports this test's `axios` and the one captured inside crawler-source.ts can diverge
// into two mock instances. Mirroring crawl-company-handler.test.ts — explicit factory +
// resetModules + dynamic import in beforeEach — guarantees both resolve to the same mock.
vi.mock('axios', () => ({ default: { post: vi.fn() } }))

let CrawlerSource: typeof import('../crawler-source')['CrawlerSource']
let axios: typeof import('axios')['default']

describe.skipIf(process.env.CI === 'true')('CrawlerSource', () => {
  let source: InstanceType<typeof CrawlerSource>

  beforeEach(async () => {
    vi.resetModules()
    ;({ CrawlerSource } = await import('../crawler-source'))
    axios = (await import('axios')).default
    vi.clearAllMocks()
    source = new CrawlerSource()
  })

  it('should call Python crawler service with correct payload', async () => {
    const mockResponse = {
      data: [
        {
          source: 'linkedin.com',
          jobs: [{ title: 'Test Job', company: 'Test Co', url: 'https://test.com', sourceUrl: 'https://test.com' }],
          errors: []
        }
      ]
    }
    vi.mocked(axios.post).mockResolvedValue(mockResponse)

    const results = await source.scrapeBulk(['https://linkedin.com/jobs/123'], 'node engineer')

    expect(axios.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        sites: ['https://linkedin.com/jobs/123'],
        keywords: 'node engineer'
      }),
      expect.any(Object)
    )
    expect(results[0].jobs[0].title).toBe('Test Job')
  })

  it('should handle service errors gracefully', async () => {
    vi.mocked(axios.post).mockRejectedValue(new Error('Network error'))

    const results = await source.scrapeBulk(['https://linkedin.com/jobs/123'], 'node engineer')

    expect(results[0].errors[0].message).toContain('Network error')
    expect(results[0].jobs).toHaveLength(0)
  })
})
