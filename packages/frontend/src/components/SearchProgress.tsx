import { useState, useEffect } from 'react'

interface StatusResponse {
  status: 'running' | 'complete' | 'failed'
  companiesDiscovered: number
  companiesCrawled: number
  companiesRemaining: number
  jobsExtracted: number
  jobsScored: number
  expandedSearch: boolean
  query: string
  startedAt: string
  completedAt?: string
}

interface SearchProgressProps {
  searchId: string
}

export function SearchProgress({ searchId }: SearchProgressProps) {
  const [status, setStatus] = useState<StatusResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const getAuthToken = () => {
    const auth = localStorage.getItem('auth')
    if (!auth) return null
    try {
      return JSON.parse(auth).token
    } catch {
      return null
    }
  }

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const token = getAuthToken()
        if (!token) {
          setError('Not authenticated')
          setLoading(false)
          return
        }

        const response = await fetch(
          `/api/searches/${searchId}/status`,
          {
            headers: {
              Authorization: `Bearer ${token}`
            }
          }
        )

        if (!response.ok) {
          throw new Error(`Failed to fetch status: ${response.statusText}`)
        }

        const data: StatusResponse = await response.json()
        setStatus(data)
        setLoading(false)
        setError(null)

        // Only continue polling if search is running
        if (data.status !== 'running') {
          return
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load status')
        setLoading(false)
      }
    }

    fetchStatus()

    // Poll every 2 seconds while running
    const intervalId = setInterval(async () => {
      try {
        const token = getAuthToken()
        if (!token) return

        const response = await fetch(
          `/api/searches/${searchId}/status`,
          {
            headers: {
              Authorization: `Bearer ${token}`
            }
          }
        )

        if (response.ok) {
          const data: StatusResponse = await response.json()
          setStatus(data)

          // Stop polling if search is complete
          if (data.status !== 'running') {
            clearInterval(intervalId)
          }
        }
      } catch (err) {
        console.error('Failed to poll status:', err)
      }
    }, 2000)

    return () => clearInterval(intervalId)
  }, [searchId])

  if (loading) {
    return (
      <div style={{
        padding: '20px',
        backgroundColor: '#f5f5f5',
        borderRadius: '4px',
        border: '1px solid #ddd'
      }}>
        <p>Loading search status...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{
        padding: '20px',
        backgroundColor: '#ffebee',
        borderRadius: '4px',
        border: '1px solid #f88',
        color: '#c33'
      }}>
        <p>{error}</p>
      </div>
    )
  }

  if (!status) {
    return (
      <div style={{
        padding: '20px',
        backgroundColor: '#f5f5f5',
        borderRadius: '4px',
        border: '1px solid #ddd'
      }}>
        <p>No status available</p>
      </div>
    )
  }

  const isRunning = status.status === 'running'

  return (
    <div style={{
      padding: '20px',
      backgroundColor: 'white',
      borderRadius: '4px',
      border: '1px solid #ddd'
    }}>
      {/* Status header */}
      <div style={{
        padding: '15px',
        backgroundColor: isRunning ? '#e3f2fd' : '#f1f8e9',
        borderRadius: '4px',
        marginBottom: '20px',
        textAlign: 'center',
        color: isRunning ? '#1565c0' : '#2d5016'
      }}>
        {isRunning ? (
          <>
            <span style={{
              display: 'inline-block',
              animation: 'spin 2s linear infinite',
              fontSize: '20px',
              marginRight: '8px'
            }}>
              🔍
            </span>
            <p style={{ display: 'inline', margin: 0 }}>Searching...</p>
          </>
        ) : status.expandedSearch ? (
          <p style={{ margin: 0 }}>📈 Expanded search to find more results</p>
        ) : (
          <p style={{ margin: 0 }}>✓ Search complete</p>
        )}
      </div>

      <style>{`
        @keyframes spin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>

      {/* Progress items */}
      <div>
        <ProgressItem
          label="Companies Discovered"
          value={status.companiesDiscovered}
        />
        <ProgressItem
          label="Companies Crawled"
          value={status.companiesCrawled}
        />
        <ProgressItem
          label="Jobs Extracted"
          value={status.jobsExtracted}
        />
        <ProgressItem
          label="Jobs Scored"
          value={status.jobsScored}
        />
      </div>

      {/* Remaining companies */}
      {status.companiesRemaining > 0 && (
        <div style={{
          marginTop: '15px',
          padding: '10px',
          backgroundColor: '#fff3e0',
          borderRadius: '4px',
          fontSize: '14px',
          color: '#e65100'
        }}>
          {status.companiesRemaining} companies remaining to crawl
        </div>
      )}
    </div>
  )
}

interface ProgressItemProps {
  label: string
  value: number
}

function ProgressItem({ label, value }: ProgressItemProps) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '12px 0',
      borderBottom: '1px solid #eee'
    }}>
      <span style={{ color: '#666' }}>{label}</span>
      <span style={{
        fontWeight: 'bold',
        fontSize: '18px',
        color: '#1976d2'
      }}>
        {value}
      </span>
    </div>
  )
}
