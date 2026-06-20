import { JobCard } from './JobCard'

interface Job {
  id: string
  title: string
  company: string
  description: string
  url: string
  salary?: string
  location: string
  matchScore: number
  matchReasoning: string
}

interface JobListProps {
  jobs: Job[]
  isLoading: boolean
}

export function JobList({ jobs, isLoading }: JobListProps) {
  if (jobs.length === 0 && isLoading) {
    return (
      <div className="card" style={{ textAlign: 'center', color: 'var(--text-faint)', fontStyle: 'italic' }}>
        <p>Discovering jobs…</p>
      </div>
    )
  }

  if (jobs.length === 0) {
    return (
      <div className="card" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
        <p>No jobs found yet. Keep searching…</p>
      </div>
    )
  }

  return (
    <div>
      {jobs.map(job => (
        <JobCard key={job.id} job={job} />
      ))}

      {isLoading && (
        <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-faint)', fontStyle: 'italic' }}>
          Discovering more jobs…
        </div>
      )}
    </div>
  )
}
