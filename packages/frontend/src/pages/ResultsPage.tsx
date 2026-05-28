import { useSSE } from '../hooks/useSSE'
import { ProgressDisplay } from '../components/ProgressDisplay'
import { JobCard } from '../components/JobCard'

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

interface ResultsPageProps {
  searchId: string
  token: string
  onBack: () => void
}

export function ResultsPage({ searchId, token, onBack }: ResultsPageProps) {
  const { status, iterationCount, jobs, isConnected, error } = useSSE(searchId, token)

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '40px 20px' }}>
      <button onClick={onBack} style={{ marginBottom: '20px' }}>← Back to Search</button>

      <h1>Search Results</h1>

      {!isConnected && error && (
        <div style={{
          padding: '12px',
          marginBottom: '20px',
          backgroundColor: '#fee',
          border: '1px solid #f88',
          borderRadius: '4px',
          color: '#c33'
        }}>
          <p>{error}</p>
          <button onClick={() => window.location.reload()}>Reconnect</button>
        </div>
      )}

      {!isConnected && !error && (
        <div style={{
          padding: '12px',
          marginBottom: '20px',
          backgroundColor: '#ffe',
          border: '1px solid #dd8',
          borderRadius: '4px',
          color: '#880'
        }}>
          Connecting to search stream...
        </div>
      )}

      <ProgressDisplay status={status} iterationCount={iterationCount} jobsFound={jobs.length} />

      {jobs.map(job => (
        <JobCard key={job.id} job={job} />
      ))}
    </div>
  )
}
