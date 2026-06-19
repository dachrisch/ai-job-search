// packages/api/src/sources/manager.ts
import { JobQuery, JobSource, SourceJob, SourceResult } from './types.js'

function normalizeUrl(url: string): string {
  return url.trim().toLowerCase().replace(/\/+$/, '')
}

export class SourceManager {
  constructor(private sources: JobSource[]) {}

  async search(query: JobQuery): Promise<SourceResult> {
    const settled = await Promise.all(
      this.sources.map(async (source): Promise<SourceResult> => {
        try {
          return await source.search(query)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return { source: source.name, jobs: [], errors: [{ message: `${source.name}: ${message}` }] }
        }
      })
    )

    const seen = new Set<string>()
    const jobs: SourceJob[] = []
    const errors: SourceResult['errors'] = []

    for (const result of settled) {
      errors.push(...result.errors)
      for (const job of result.jobs) {
        const key = normalizeUrl(job.url)
        if (seen.has(key)) continue
        seen.add(key)
        jobs.push(job)
      }
    }

    return { source: 'source-manager', jobs, errors }
  }
}
