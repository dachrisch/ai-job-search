import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useSSE } from '../hooks/useSSE'
import { useApi } from '../hooks/useApi'
import { StatusLine } from '../components/StatusLine'
import { JobList } from '../components/JobList'

interface ResultsPageProps {
  token: string
}

export function ResultsPage({ token }: ResultsPageProps) {
  const { id: searchId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { getSearch, getJobs } = useApi(token)
  const { status: sseStatus, jobs: sseJobs, isConnected, error: sseError } = useSSE(searchId!, token)

  const [hydratedJobs, setHydratedJobs] = useState<any[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [hydratedStatus, setHydratedStatus] = useState<string>('')
  const [hydrating, setHydrating] = useState(true)

  // Hydrate from API on mount — gets results even if SSE hasn't connected yet
  useEffect(() => {
    if (!searchId) return
    let cancelled = false
    ;(async () => {
      try {
        const [search, jobsData] = await Promise.all([
          getSearch(searchId),
          getJobs(searchId),
        ])
        if (cancelled) return
        setSearchQuery(search.query || '')
        setHydratedStatus(search.status || '')
        setHydratedJobs(jobsData.jobs || jobsData || [])
      } catch {
        // SSE will take over if API hydration fails
      } finally {
        setHydrating(false)
      }
    })()
    return () => { cancelled = true }
  }, [searchId])

  // Merge: SSE jobs take priority when available, fall back to hydrated jobs
  const jobs = sseJobs.length > 0 ? sseJobs : hydratedJobs
  const status = (sseStatus || hydratedStatus) as 'running' | 'complete' | 'failed'
  const isSearchRunning = status === 'running'
  const sortedJobs = [...jobs].sort((a: any, b: any) => (b.matchScore || 0) - (a.matchScore || 0))

  return (
    <div className="container-wide">
      {searchQuery && (
        <div style={{ marginBottom: 12 }}>
          <button className="btn btn-ghost" onClick={() => navigate('/history')} style={{ marginRight: 8 }}>
            &larr; History
          </button>
          <span className="faint" style={{ fontSize: 14 }}>
            <strong>{searchQuery}</strong>
          </span>
          <button className="btn btn-ghost" style={{ marginLeft: 8, fontSize: 13 }}
            onClick={() => navigate(`/search/${searchId}/insights`)}>
            Insights
          </button>
        </div>
      )}

      {hydrating && (
        <div className="alert alert-info">Loading results...</div>
      )}

      {!isConnected && sseError && (
        <div className="alert alert-error">
          <p>{sseError}</p>
          <button className="btn" onClick={() => window.location.reload()}>Reconnect</button>
        </div>
      )}
      {!isConnected && !sseError && !hydrating && (
        <div className="alert alert-info">Connecting to search stream...</div>
      )}

      <StatusLine status={status} jobsFound={sortedJobs.length}
        onRetry={() => navigate('/')} />

      <div className="job-list">
        <JobList jobs={sortedJobs} isLoading={isSearchRunning} />
      </div>
    </div>
  )
}
