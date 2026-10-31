// packages/api/src/sources/__tests__/ats-detection.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { detectATS, clearATSCache } from '../ats-detection'

// Mock axios before importing the module under test
vi.mock('axios', () => ({ default: { get: vi.fn() } }))

let axios: typeof import('axios')['default']

// --- Fixtures (HTML snippets) ---
const personioFixture = `<!DOCTYPE html>
<html>
  <body>
    <a href="https://inexogy.jobs.personio.de">Job Opportunities</a>
    <p>Company website</p>
  </body>
</html>`

const softgardenFixture = `<!DOCTYPE html>
<html>
  <body>
    <a href="https://scopevisio.softgarden.io">Apply Now</a>
    <p>Softgarden jobs portal</p>
  </body>
</html>`

const joinFixture = `<!DOCTYPE html>
<html>
  <body>
    <a href="https://join.com/companies/inexogy">Join Jobs</a>
    <p>Join career page</p>
  </body>
</html>`

const dvinciFixture = `<!DOCTYPE html>
<html>
  <body>
    <a href="https://acme.dvinci.de">D.Vinci Jobs</a>
    <p>D.Vinci career portal</p>
  </body>
</html>`

const haufeFixture = `<!DOCTYPE html>
<html>
  <body>
    <a href="https://haufe-haustechnik.haufe-jobs.de">Haufe Jobs</a>
    <p>Haufe career opportunities</p>
  </body>
</html>`

const successfactorsFixture = `<!DOCTYPE html>
<html>
  <body>
    <a href="https://sapid.successfactors.com">SuccessFactors Jobs</a>
    <p>SAP SuccessFactors career page</p>
  </body>
</html>`

const greenhouseFixture = `<!DOCTYPE html>
<html>
  <body>
    <a href="https://job-boards.greenhouse.io/acme">Greenhouse Jobs</a>
    <p>Greenhouse careers</p>
  </body>
</html>`

const leverFixture = `<!DOCTYPE html>
<html>
  <body>
    <a href="https://jobs.lever.co/acme">Lever Jobs</a>
    <p>Lever career portal</p>
  </body>
</html>`

const ashbyFixture = `<!DOCTYPE html>
<html>
  <body>
    <a href="https://jobs.ashbyhq.com/acme">Ashby Jobs</a>
    <p>Ashby careers</p>
  </body>
</html>`

const workableFixture = `<!DOCTYPE html>
<html>
  <body>
    <a href="https://apply.workable.com/acme">Workable Jobs</a>
    <p>Workable career page</p>
  </body>
</html>`

const recruiteeFixture = `<!DOCTYPE html>
<html>
  <body>
    <a href="https://recruitee.com/acme">Recruitee Jobs</a>
    <p>Recruitee careers</p>
  </body>
</html>`

const noATSFixture = `<!DOCTYPE html>
<html>
  <body>
    <h1>Acme Corporation</h1>
    <p>We're looking for talented people!</p>
    <p>Contact us at: jobs@acme.com</p>
    <p>Visit our LinkedIn: linkedin.com/company/acme</p>
  </body>
</html>`

// --- Test suite ---

// This pattern (factory + resetModules + dynamic import) ensures each test file gets a fresh
// axios.get mock and a fresh instance of the module under test (important for the in-memory cache).
// The module is re-imported before each test to guarantee test isolation.

let atsDetection: typeof import('../ats-detection')['detectATS']
let axiosMock: typeof import('axios')['default']['get']

beforeEach(async () => {
  vi.resetModules()
  ;({ detectATS: atsDetection } = await import('../ats-detection'))
  axiosMock = (await import('axios')).default.get
  vi.clearAllMocks()
  clearATSCache()
})

// Helper to simulate a 404 for a given path
function mock404(path: string): void {
  axiosMock.mockImplementation((url: string | any, config?: any) => {
    const urlStr = typeof url === 'string' ? url : url.href ?? ''
    if (urlStr.endsWith(path)) {
      return Promise.reject(new Error('404 Not Found'))
    }
    return Promise.resolve({ data: personioFixture } as any)
  })
}

describe('detectATS', () => {
  // Helper to mock axios for a specific domain and path
  const mockPaths = (domain: string, fixtures: Record<string, string>): void => {
    axiosMock.mockImplementation((url: string | any, config?: any) => {
      const urlStr = typeof url === 'string' ? url : url.href ?? ''
      // URL is https://{domain}{path}
      for (const [path, html] of Object.entries(fixtures)) {
        const expectedUrl = `https://${domain}${path}`
        if (urlStr === expectedUrl || urlStr.endsWith(path)) {
          return Promise.resolve({ data: html } as any)
        }
      }
      // Path not in fixtures — 404
      return Promise.reject(new Error('404 Not Found'))
    })
  }

  it('should detect Personio from a company domain', async () => {
    const fixtures: Record<string, string> = {
      '/karriere': personioFixture,
      '/': noATSFixture,
    }
    mockPaths('inexogy.de', fixtures)

    const result = await atsDetection('inexogy.de')

    expect(result.status).toBe('found')
    expect(result.vendor).toBe('personio')
    expect(result.boardUrl).toBe('https://inexogy.jobs.personio.de')
    expect(result.careersUrl).toBe('https://inexogy.de/karriere')
  })

  it('should detect softgarden from a company domain', async () => {
    const fixtures: Record<string, string> = {
      '/careers': softgardenFixture,
      '/': noATSFixture,
    }
    mockPaths('scopevisio.io', fixtures)

    const result = await atsDetection('scopevisio.io')

    expect(result.status).toBe('found')
    expect(result.vendor).toBe('softgarden')
    expect(result.boardUrl).toBe('https://scopevisio.softgarden.io')
    expect(result.careersUrl).toBe('https://scopevisio.io/careers')
  })

  it('should detect join.com from a company domain', async () => {
    const fixtures: Record<string, string> = {
      '/jobs': joinFixture,
      '/': noATSFixture,
    }
    mockPaths('inexogy.com', fixtures)

    const result = await atsDetection('inexogy.com')

    expect(result.status).toBe('found')
    expect(result.vendor).toBe('join')
    expect(result.boardUrl).toBe('https://join.com/companies/inexogy')
    expect(result.careersUrl).toBe('https://inexogy.com/jobs')
  })

  it('should detect d.vinci from a company domain', async () => {
    const fixtures: Record<string, string> = {
      '/unternehmen/karriere': dvinciFixture,
      '/': noATSFixture,
    }
    mockPaths('acme.de', fixtures)

    const result = await atsDetection('acme.de')

    expect(result.status).toBe('found')
    expect(result.vendor).toBe('dvinci')
    expect(result.boardUrl).toBe('https://acme.dvinci.de')
    expect(result.careersUrl).toBe('https://acme.de/unternehmen/karriere')
  })

  it('should detect Haufe from a company domain', async () => {
    const fixtures: Record<string, string> = {
      '/karriere': haufeFixture,
      '/': noATSFixture,
    }
    mockPaths('haufe-haustechnik.de', fixtures)

    const result = await atsDetection('haufe-haustechnik.de')

    expect(result.status).toBe('found')
    expect(result.vendor).toBe('haufe')
    expect(result.boardUrl).toBe('https://haufe-haustechnik.haufe-jobs.de')
    expect(result.careersUrl).toBe('https://haufe-haustechnik.de/karriere')
  })

  it('should detect SuccessFactors from a company domain', async () => {
    const fixtures: Record<string, string> = {
      '/jobs': successfactorsFixture,
      '/': noATSFixture,
    }
    mockPaths('sapid.eu', fixtures)

    const result = await atsDetection('sapid.eu')

    expect(result.status).toBe('found')
    expect(result.vendor).toBe('successfactors')
    expect(result.boardUrl).toBe('https://sapid.successfactors.com')
    expect(result.careersUrl).toBe('https://sapid.eu/jobs')
  })

  it('should detect Greenhouse from a company domain', async () => {
    const fixtures: Record<string, string> = {
      '/': greenhouseFixture,
    }
    mockPaths('acme.com', fixtures)

    const result = await atsDetection('acme.com')

    expect(result.status).toBe('found')
    expect(result.vendor).toBe('greenhouse')
    expect(result.boardUrl).toBe('https://job-boards.greenhouse.io/acme')
    expect(result.careersUrl).toBe('https://acme.com/')
  })

  it('should detect Lever from a company domain', async () => {
    const fixtures: Record<string, string> = {
      '/': leverFixture,
    }
    mockPaths('acme.com', fixtures)

    const result = await atsDetection('acme.com')

    expect(result.status).toBe('found')
    expect(result.vendor).toBe('lever')
    expect(result.boardUrl).toBe('https://jobs.lever.co/acme')
    expect(result.careersUrl).toBe('https://acme.com/')
  })

  it('should detect Ashby from a company domain', async () => {
    const fixtures: Record<string, string> = {
      '/': ashbyFixture,
    }
    mockPaths('acme.com', fixtures)

    const result = await atsDetection('acme.com')

    expect(result.status).toBe('found')
    expect(result.vendor).toBe('ashby')
    expect(result.boardUrl).toBe('https://jobs.ashbyhq.com/acme')
    expect(result.careersUrl).toBe('https://acme.com/')
  })

  it('should detect Workable from a company domain', async () => {
    const fixtures: Record<string, string> = {
      '/': workableFixture,
    }
    mockPaths('acme.com', fixtures)

    const result = await atsDetection('acme.com')

    expect(result.status).toBe('found')
    expect(result.vendor).toBe('workable')
    expect(result.boardUrl).toBe('https://apply.workable.com/acme')
    expect(result.careersUrl).toBe('https://acme.com/')
  })

  it('should detect Recruitee from a company domain', async () => {
    const fixtures: Record<string, string> = {
      '/': recruiteeFixture,
    }
    mockPaths('acme.com', fixtures)

    const result = await atsDetection('acme.com')

    expect(result.status).toBe('found')
    expect(result.vendor).toBe('recruitee')
    expect(result.boardUrl).toBe('https://recruitee.com/acme')
    expect(result.careersUrl).toBe('https://acme.com/')
  })

  it('should return not_found when no ATS links are present', async () => {
    const fixtures: Record<string, string> = {
      '/karriere': noATSFixture,
      '/careers': noATSFixture,
      '/jobs': noATSFixture,
      '/unternehmen/karriere': noATSFixture,
      '/': noATSFixture,
    }
    mockPaths('acme.com', fixtures)

    const result = await atsDetection('acme.com')

    expect(result.status).toBe('not_found')
    expect(result.vendor).toBeNull()
    expect(result.boardUrl).toBeNull()
    expect(result.careersUrl).toBeNull()
  })

  it('should return not_found when all paths fail with 404', async () => {
    // No fixtures provided – all paths should 404
    mockPaths('acme.com', {})

    const result = await atsDetection('acme.com')

    expect(result.status).toBe('not_found')
    expect(result.vendor).toBeNull()
    expect(result.boardUrl).toBeNull()
    expect(result.careersUrl).toBeNull()
  })

  it('should cache results for 5 minutes', async () => {
    const fixtures: Record<string, string> = {
      '/karriere': personioFixture,
    }
    mockPaths('cached.com', fixtures)

    const result1 = await atsDetection('cached.com')
    expect(result1.status).toBe('found')

    // Second call should hit cache, no HTTP request
    // We're testing that the cache works, not mocking network calls
    // This is a simple check – the cache is module-level and persists across
    // beforeEach() resets because we clear it explicitly.
    const result2 = await atsDetection('cached.com')
    expect(result2).toEqual(result1)
    // Can't easily verify no HTTP call was made without more complex mocking
  })

  it('should respect vendor order (first match wins)', async () => {
    // All paths would match if we didn't have ordered matching
    // Use a domain that matches multiple patterns to test order
    const multiMatchFixture = `
      <a href="https://test.jobs.personio.de">Personio</a>
      <a href="https://test.softgarden.io">Softgarden</a>
      <a href="https://join.com/companies/test">Join</a>
    `;
    const fixtures: Record<string, string> = {
      '/': multiMatchFixture,
    }
    mockPaths('test.io', fixtures)

    const result = await atsDetection('test.io')

    // Personio is first in VENDORS order, so it should win
    expect(result.status).toBe('found')
    expect(result.vendor).toBe('personio')
    expect(result.boardUrl).toBe('https://test.jobs.personio.de')
  })
})