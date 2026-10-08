// packages/api/src/sources/arbeitsagentur-source.ts
import axios from 'axios'
import { JobQuery, JobSource, SourceJob, SourceResult } from './types.js'
import { expandTitleVariants } from './query-parser.js'

// v4 started answering 403 for every request (observed 2026-10-06); v6 serves the
// same public key but renamed the payload fields (stellenangebote → ergebnisliste, …).
const API_URL = 'https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc/v6/jobs'
const API_KEY = 'jobboerse-jobsuche' // public, well-known client key
const DETAIL_BASE = 'https://www.arbeitsagentur.de/jobsuche/jobdetail/'
const BOARD_URL = 'https://www.arbeitsagentur.de/jobsuche/'
const PAGE_SIZE = 50
const MAX_PAGES = 2
const TIMEOUT_MS = 5000
// Bound the fan-out: at most 3 variants in flight, 400 jobs stored
// (issue #187). JS is single-threaded, so the shared `seen` set needs no
// locking — each variant's dedupe loop runs to completion synchronously.
const VARIANT_CONCURRENCY = 3
const MAX_JOBS_TOTAL = 400

interface Posting {
  referenznummer?: string
  stellenangebotsTitel?: string
  firma?: string
  hauptberuf?: string
  gehaltsspanneVon?: number
  gehaltsspanneBis?: number
  homeofficemoeglich?: boolean
  datumErsteVeroeffentlichung?: string
  stellenlokationen?: Array<{ adresse?: { ort?: string; region?: string; plz?: string } }>
}

export class ArbeitsagenturSource implements JobSource {
  name = 'arbeitsagentur'
  tier = 1 as const

  async search(query: JobQuery): Promise<SourceResult> {
    const variants = expandTitleVariants(query.keywords)
    const seen = new Set<string>()
    const jobs: SourceJob[] = []
    const errors: SourceResult['errors'] = []

    // One variant failing must not kill the others: failures are returned,
    // not thrown (the SourceResult contract).
    const searchVariant = async (keywords: string): Promise<void> => {
      try {
        for (let page = 1; page <= MAX_PAGES; page++) {
          const postings = await this.fetchPage({ ...query, keywords }, page)
          for (const posting of postings) {
            if (jobs.length >= MAX_JOBS_TOTAL) return
            const job = this.toSourceJob(posting)
            if (!job || seen.has(posting.referenznummer!)) continue
            seen.add(posting.referenznummer!)
            jobs.push(job)
          }
          // A short page means there is nothing further to fetch.
          if (postings.length < PAGE_SIZE) break
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        errors.push({ message: `${keywords}: ${message}` })
      }
    }

    const queue = [...variants]
    const workers = Array.from(
      { length: Math.min(VARIANT_CONCURRENCY, queue.length) },
      async () => {
        while (queue.length > 0) {
          const variant = queue.shift()!
          await searchVariant(variant)
        }
      }
    )
    await Promise.all(workers)

    return { source: this.name, jobs, errors }
  }

  private async fetchPage(query: JobQuery, page: number): Promise<Posting[]> {
    const response = await axios.get(API_URL, {
      params: {
        was: query.keywords,
        ...(query.location ? { wo: query.location } : {}),
        ...(query.radius ? { umkreis: query.radius } : {}),
        size: PAGE_SIZE,
        page,
      },
      headers: { 'X-API-Key': API_KEY },
      timeout: TIMEOUT_MS,
    })

    return Array.isArray(response.data?.ergebnisliste) ? response.data.ergebnisliste : []
  }

  private toSourceJob(p: Posting): SourceJob | null {
    if (!p.referenznummer || !p.stellenangebotsTitel) return null

    const company = p.firma ?? 'Unbekannt'
    const location = p.stellenlokationen?.[0]?.adresse?.ort ?? 'Deutschland'
    const url = DETAIL_BASE + encodeURIComponent(p.referenznummer)

    return {
      title: p.stellenangebotsTitel,
      company,
      // The list endpoint has no full description; build one from the structured
      // fields so the scorer has more than the title to judge.
      description: this.describe(p, company, location),
      url,
      location,
      sourceUrl: BOARD_URL,
      // Carried through for the validity filter (stale-posting cutoff).
      publishedAt: p.datumErsteVeroeffentlichung,
    }
  }

  private describe(p: Posting, company: string, location: string): string {
    const parts = [`${p.stellenangebotsTitel} bei ${company} in ${location}.`]
    if (p.hauptberuf) parts.push(`Beruf: ${p.hauptberuf}.`)
    if (p.gehaltsspanneVon && p.gehaltsspanneBis) {
      // Explicit German thousands grouping. toLocaleString('de-DE') depends on
      // the runtime's ICU data: node:alpine (production image) and other
      // small-icu runtimes silently fall back to en-US ("58,000").
      const fmt = (n: number) =>
        Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')
      parts.push(`Gehalt: ${fmt(p.gehaltsspanneVon)}–${fmt(p.gehaltsspanneBis)} EUR/Jahr.`)
    }
    if (p.homeofficemoeglich) parts.push('Homeoffice möglich.')
    if (p.datumErsteVeroeffentlichung) parts.push(`Veröffentlicht: ${p.datumErsteVeroeffentlichung}.`)
    return parts.join(' ')
  }
}
