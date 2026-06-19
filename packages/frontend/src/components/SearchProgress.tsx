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
      <div className="card">
        <p>Loading search status...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="alert alert-error">
        <p>{error}</p>
      </div>
    )
  }

  if (!status) {
    return (
      <div className="card">
        <p>No status available</p>
      </div>
    )
  }

  return (
    <div className="card">
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
        <div className="alert alert-info" style={{ marginTop: 12 }}>
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
    <div className="progress-row">
      <span className="k">{label}</span>
      <span className="v">{value}</span>
    </div>
  )
}
