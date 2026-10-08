// packages/api/src/sources/validity-filter.ts
//
// Pre-persistence quality gate for Tier-1 jobs (issue #187): a single
// Arbeitsagentur keyword returns ~30/52 unrelated or invalid postings
// (2024 reposts, duplicated reposts, training providers). Pure functions —
// no DB, no LLM — so the rules are cheap to unit-test and tune.

import { SourceJob } from './types.js'

export type RejectionReason = 'stale' | 'duplicate' | 'blocklisted'

export interface RejectedJob {
  job: SourceJob
  reason: RejectionReason
}

export interface ValidityResult {
  valid: SourceJob[]
  rejected: RejectedJob[]
  /** Kept, but worth reviewing (see AGENCY_PATTERN below). */
  flagged: SourceJob[]
}

// Postings older than this are dropped (issue: a current result is from 2024).
const MAX_AGE_DAYS = 180

// Exact (normalized) company names that are never employers.
function blocklistedCompanies(): string[] {
  const fromEnv = (process.env.BLOCKLISTED_COMPANIES || 'alfatraining')
    .split(',')
    .map(s => normalize(s))
    .filter(Boolean)
  return fromEnv
}

// Recruiting-industry signals. Heuristic only: agency suspects are KEPT and
// flagged for review, because false positives would hide real employers.
const AGENCY_PATTERN = /personalberatung|personaldienst|zeitarbeit|arbeitnehmerüberlass|recruiting|staffing|headhunt/i

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}

function dedupeKey(job: SourceJob): string {
  return `${normalize(job.title)}@@${normalize(job.company)}`
}

function isStale(job: SourceJob, nowMs: number): boolean {
  if (!job.publishedAt) return false
  const published = new Date(job.publishedAt).getTime()
  if (!Number.isFinite(published)) return false
  return nowMs - published > MAX_AGE_DAYS * 24 * 60 * 60 * 1000
}

export function filterValidJobs(jobs: SourceJob[], nowMs = Date.now()): ValidityResult {
  const blocklist = blocklistedCompanies()
  const seen = new Set<string>()
  const valid: SourceJob[] = []
  const rejected: RejectedJob[] = []
  const flagged: SourceJob[] = []

  for (const job of jobs) {
    if (isStale(job, nowMs)) {
      rejected.push({ job, reason: 'stale' })
      continue
    }
    const company = normalize(job.company)
    if (blocklist.some(entry => company.includes(entry))) {
      rejected.push({ job, reason: 'blocklisted' })
      continue
    }
    const key = dedupeKey(job)
    if (seen.has(key)) {
      rejected.push({ job, reason: 'duplicate' })
      continue
    }
    seen.add(key)
    valid.push(job)
    if (AGENCY_PATTERN.test(job.company) || AGENCY_PATTERN.test(job.description)) {
      flagged.push(job)
    }
  }

  return { valid, rejected, flagged }
}
