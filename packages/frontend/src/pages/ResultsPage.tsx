import { useState } from 'react'
import { useSSE } from '../hooks/useSSE'
import { ProgressDisplay } from '../components/ProgressDisplay'
import { SearchProgress } from '../components/SearchProgress'
import { JobList } from '../components/JobList'

interface ResultsPageProps {
  searchId: string
  token: string
  onBack: () => void
}

export function ResultsPage({ searchId, token, onBack }: ResultsPageProps) {
  const { status, iterationCount, jobs, isConnected, error } = useSSE(searchId, token)
  const [loadMoreCallCount, setLoadMoreCallCount] = useState(0)

  const handleLoadMore = () => {
    setLoadMoreCallCount(prev => prev + 1)
  }

  const isSearchRunning = status === 'running'

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '40px 20px' }}>
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

      {/* Two-column layout: sidebar (progress) + main (jobs) */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '250px 1fr',
        gap: '20px',
        marginTop: '30px'
      }}>
        {/* Sidebar with progress */}
        <div style={{
          position: 'sticky',
          top: '20px',
          height: 'fit-content'
        }}>
          <SearchProgress searchId={searchId} />
        </div>

        {/* Main content with job list */}
        <div style={{
          padding: '20px',
          backgroundColor: 'white',
          borderRadius: '4px',
          border: '1px solid #ddd'
        }}>
          <JobList
            searchId={searchId}
            onLoadMore={handleLoadMore}
            isLoading={isSearchRunning}
          />
        </div>
      </div>
    </div>
  )
}
