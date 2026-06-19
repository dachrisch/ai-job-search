// packages/api/src/sources/types.ts

/** A normalized, structured job search query handed to every source. */
export interface JobQuery {
  keywords: string
  location?: string
  radius?: number // km
  remote?: boolean
  raw: string // the original user query, unmodified
}

/** A job as returned by a source — lean, pre-persistence shape. */
export interface SourceJob {
  title: string
  company: string
  description: string
  url: string
  location: string
  salary?: string
  sourceUrl: string // identifier of the producing source, e.g. "arbeitsagentur"
}

/** The result of querying a single source. Failures are returned, not thrown. */
export interface SourceResult {
  source: string
  jobs: SourceJob[]
  errors: Array<{ message: string }>
}

/** A job source. Query in, jobs out. No DB or event-queue knowledge. */
export interface JobSource {
  name: string
  tier: 1 | 2 | 3 // 1 = API, 2 = search+LLM, 3 = ATS adapter
  search(query: JobQuery): Promise<SourceResult>
}
