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

interface JobCardProps {
  job: Job
}

export function JobCard({ job }: JobCardProps) {
  const scoreClass = job.matchScore >= 80 ? 'score-ok' : 'score-warn'
  return (
    <div className="card">
      <div className="job-top">
        <div style={{ flex: 1 }}>
          <h3 className="job-title">{job.title}</h3>
          <p className="job-meta">{job.company} · {job.location}{job.salary ? ` · ${job.salary}` : ''}</p>
          <p className="job-desc">{job.description.substring(0, 200)}…</p>
        </div>
        <div className={`score ${scoreClass}`}>
          <b>{Math.round(job.matchScore)}</b>
          <small>Match</small>
        </div>
      </div>
      <p className="job-why"><strong>Why this match:</strong> {job.matchReasoning}</p>
      <a className="job-link" href={job.url} target="_blank" rel="noopener noreferrer">View job →</a>
    </div>
  )
}
