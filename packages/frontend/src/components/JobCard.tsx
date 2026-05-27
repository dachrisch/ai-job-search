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
  return (
    <div style={{
      border: '1px solid #ddd',
      borderRadius: '4px',
      padding: '15px',
      marginBottom: '15px',
      backgroundColor: 'white'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <h3 style={{ margin: '0 0 5px 0' }}>{job.title}</h3>
          <p style={{ margin: '0 0 10px 0', color: '#666' }}>{job.company} • {job.location}</p>
          <p style={{ margin: '0 0 10px 0', color: '#444' }}>{job.description.substring(0, 200)}...</p>
        </div>
        <div style={{
          backgroundColor: job.matchScore >= 80 ? '#c8e6c9' : '#fff9c4',
          padding: '10px 15px',
          borderRadius: '4px',
          textAlign: 'center',
          marginLeft: '15px'
        }}>
          <p style={{ margin: 0, fontSize: '24px', fontWeight: 'bold' }}>{Math.round(job.matchScore)}</p>
          <p style={{ margin: '5px 0 0 0', fontSize: '12px' }}>Match</p>
        </div>
      </div>
      <p style={{ margin: '10px 0 0 0', color: '#555', fontSize: '14px' }}>
        <strong>Why this match:</strong> {job.matchReasoning}
      </p>
      <a
        href={job.url}
        target="_blank"
        rel="noopener noreferrer"
        style={{ marginTop: '10px', display: 'inline-block', color: '#1976d2' }}
      >
        View Job →
      </a>
    </div>
  )
}
