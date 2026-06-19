import { useState } from 'react'
import { useSSE } from '../hooks/useSSE'
import { StatusLine } from '../components/StatusLine'
import { SearchProgress } from '../components/SearchProgress'
import { JobList } from '../components/JobList'

interface ResultsPageProps {
  searchId: string
  token: string
  onBack: () => void
}

export function ResultsPage({ searchId, token, onBack }: ResultsPageProps) {
  const { status, jobs, isConnected, error } = useSSE(searchId, token)
  const [, setLoadMoreCallCount] = useState(0)

  const handleLoadMore = () => setLoadMoreCallCount(prev => prev + 1)
  const isSearchRunning = status === 'running'

  return (
    <div className="container-wide">
      {!isConnected && error && (
        <div className="alert alert-error">
          <p>{error}</p>
          <button className="btn" onClick={() => window.location.reload()}>Reconnect</button>
        </div>
      )}
      {!isConnected && !error && (
        <div className="alert alert-info">Connecting to search stream…</div>
      )}

      <StatusLine status={status} jobsFound={jobs.length} onRetry={onBack} />

      <details className="details-toggle">
        <summary>Search details</summary>
        <SearchProgress searchId={searchId} />
      </details>

      <div className="job-list">
        <JobList searchId={searchId} onLoadMore={handleLoadMore} isLoading={isSearchRunning} />
      </div>
    </div>
  )
}
