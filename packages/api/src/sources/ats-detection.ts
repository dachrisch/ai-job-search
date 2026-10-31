// packages/api/src/sources/ats-detection.ts
import axios from 'axios'

export interface ATSDetectionResult {
  vendor: string | null
  boardUrl: string | null
  careersUrl: string | null
  status: 'found' | 'not_found'
}

interface CacheEntry {
  result: ATSDetectionResult
  expiry: number
}

const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes
const REQUEST_TIMEOUT_MS = 10000

const cache = new Map<string, CacheEntry>()

const CAREER_PATHS = ['/karriere', '/careers', '/jobs', '/unternehmen/karriere', '/']

// Order matters: first match wins
const VENDORS: Array<{
  vendor: string
  regex: RegExp
  build: (groups: RegExpExecArray | null) => string | null
}> = [
  { vendor: 'personio', regex: /([a-z0-9-]+)\.jobs\.personio\.(de|com)/, build: (m) => m ? `https://${m[1]}.jobs.personio.${m[2]}` : null },
  { vendor: 'softgarden', regex: /([a-z0-9-]+)\.softgarden\.io/, build: (m) => m ? `https://${m[1]}.softgarden.io` : null },
  { vendor: 'join', regex: /join\.com\/companies\/([a-z0-9-]+)/, build: (m) => m ? `https://join.com/companies/${m[1]}` : null },
  { vendor: 'dvinci', regex: /([a-z0-9-]+)\.dvinci\.(de|eu|com)/, build: (m) => m ? `https://${m[1]}.dvinci.${m[2]}` : null },
  { vendor: 'haufe', regex: /([a-z0-9-]+)\.haufe-jobs\.de/, build: (m) => m ? `https://${m[1]}.haufe-jobs.de` : null },
  { vendor: 'successfactors', regex: /([a-z0-9-]+)\.successfactors\.(eu|com)/, build: (m) => m ? `https://${m[1]}.successfactors.${m[2]}` : null },
  { vendor: 'greenhouse', regex: /job-boards\.greenhouse\.io\/([a-z0-9-]+)/, build: (m) => m ? `https://job-boards.greenhouse.io/${m[1]}` : null },
  { vendor: 'lever', regex: /jobs\.lever\.co\/([a-z0-9-]+)/, build: (m) => m ? `https://jobs.lever.co/${m[1]}` : null },
  { vendor: 'ashby', regex: /jobs\.ashbyhq\.com\/([a-z0-9-]+)/, build: (m) => m ? `https://jobs.ashbyhq.com/${m[1]}` : null },
  { vendor: 'workable', regex: /apply\.workable\.com\/([a-z0-9-]+)/, build: (m) => m ? `https://apply.workable.com/${m[1]}` : null },
  { vendor: 'recruitee', regex: /recruitee\.com\/([a-z0-9-]+)/, build: (m) => m ? `https://recruitee.com/${m[1]}` : null },
]

function findVendor(html: string): { vendor: string; boardUrl: string } | null {
  for (const { vendor, regex, build } of VENDORS) {
    const match = regex.exec(html)
    if (match) {
      const boardUrl = build(match)
      if (boardUrl) return { vendor, boardUrl }
    }
  }
  return null
}

export async function detectATS(domain: string): Promise<ATSDetectionResult> {
  // Return cached result if still valid
  const cached = cache.get(domain)
  if (cached && Date.now() < cached.expiry) {
    return cached.result
  }

  // Try each career path in order
  for (const path of CAREER_PATHS) {
    const url = `https://${domain}${path}`
    let html: string
    try {
      const response = await axios.get(url, { timeout: REQUEST_TIMEOUT_MS })
      html = typeof response.data === 'string' ? response.data : String(response.data ?? '')
    } catch {
      // Path failed (404, network error, etc.) — try the next one
      continue
    }

    const match = findVendor(html)
    if (match) {
      const result: ATSDetectionResult = {
        vendor: match.vendor,
        boardUrl: match.boardUrl,
        careersUrl: url,
        status: 'found',
      }
      cache.set(domain, { result, expiry: Date.now() + CACHE_TTL_MS })
      return result
    }
  }

  const result: ATSDetectionResult = {
    vendor: null,
    boardUrl: null,
    careersUrl: null,
    status: 'not_found',
  }
  cache.set(domain, { result, expiry: Date.now() + CACHE_TTL_MS })
  return result
}

// Exported for tests to reset the cache between cases
export function clearATSCache(): void {
  cache.clear()
}