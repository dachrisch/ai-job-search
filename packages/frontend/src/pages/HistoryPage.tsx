import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthContext } from '../hooks/AuthContext'
import { useApi } from '../hooks/useApi'

interface SearchSummary {
  searchId: string
  query: string
  status: string
  jobsScored: number
  jobsExtracted: number
  companiesDiscovered: number
  companiesCrawled: number
  failureReason: string | null
  createdAt: string
  completedAt: string | null
}

export function HistoryPage() {
  const { auth } = useAuthContext()
  const { listSearches } = useApi(auth.token)
  const navigate = useNavigate()
  const [searches, setSearches] = useState<SearchSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    listSearches()
      .then(setSearches)
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load history'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return <div className="container"><div className="alert alert-info">Loading search history...</div></div>
  }

  return (
    <div className="container">
      <div className="hero">
        <h1 className="display" style={{ fontSize: 28 }}>Search History</h1>
        <p className="subtitle">Your past searches. Click to view results.</p>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {searches.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <p className="faint">No searches yet.</p>
          <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => navigate('/')}>
            Start your first search
          </button>
        </div>
      )}

      <div className="search-history-list">
        {searches.map(s => (
          <div
            key={s.searchId}
            className="search-history-card"
            onClick={() => navigate(`/search/${s.searchId}`)}
            role="button"
            tabIndex={0}
          >
            <div className="search-history-card-header">
              <span className="search-history-query">{s.query}</span>
              <span className={`status-pill status-pill--${s.status}`}>{s.status}</span>
            </div>
            <div className="search-history-meta">
              <span>{s.jobsScored} scored</span>
              <span>{s.jobsExtracted} extracted</span>
              <span>{s.companiesDiscovered} companies</span>
            </div>
            <div className="search-history-date">
              {new Date(s.createdAt).toLocaleDateString()} {new Date(s.createdAt).toLocaleTimeString()}
              {s.completedAt && <> — completed {new Date(s.completedAt).toLocaleTimeString()}</>}
            </div>
            {s.failureReason && (
              <div className="search-history-failure faint">{s.failureReason}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
