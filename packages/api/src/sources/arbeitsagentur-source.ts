// packages/api/src/sources/arbeitsagentur-source.ts
import axios from 'axios'
import { JobQuery, JobSource, SourceJob, SourceResult } from './types.js'

const API_URL = 'https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc/v4/jobs'
const API_KEY = 'jobboerse-jobsuche' // public, well-known client key
const DETAIL_BASE = 'https://www.arbeitsagentur.de/jobsuche/jobdetail/'
const BOARD_URL = 'https://www.arbeitsagentur.de/jobsuche/'
const DEFAULT_SIZE = 25
const TIMEOUT_MS = 5000

interface Posting {
  refnr?: string
  titel?: string
  beruf?: string
  arbeitgeber?: string
  arbeitsort?: { ort?: string; region?: string; plz?: string }
}

export class ArbeitsagenturSource implements JobSource {
  name = 'arbeitsagentur'
  tier = 1 as const

  async search(query: JobQuery): Promise<SourceResult> {
    const response = await axios.get(API_URL, {
      params: {
        was: query.keywords,
        ...(query.location ? { wo: query.location } : {}),
        ...(query.radius ? { umkreis: query.radius } : {}),
        size: DEFAULT_SIZE,
      },
      headers: { 'X-API-Key': API_KEY },
      timeout: TIMEOUT_MS,
    })

    const postings: Posting[] = Array.isArray(response.data?.stellenangebote)
      ? response.data.stellenangebote
      : []

    const jobs = postings
      .map((p) => this.toSourceJob(p))
      .filter((j): j is SourceJob => j !== null)

    return { source: this.name, jobs, errors: [] }
  }

  private toSourceJob(p: Posting): SourceJob | null {
    if (!p.refnr || !p.titel) return null

    const company = p.arbeitgeber ?? 'Unbekannt'
    const location = p.arbeitsort?.ort ?? 'Deutschland'
    const url = DETAIL_BASE + encodeURIComponent(p.refnr)

    return {
      title: p.titel,
      company,
      // The list endpoint has no full description; synthesize a non-empty one to
      // satisfy the required Job.description field. Enrichment via the job-detail
      // endpoint is a Tier-1 follow-up.
      description: `${p.titel} bei ${company} in ${location}.`,
      url,
      location,
      sourceUrl: BOARD_URL,
    }
  }
}
