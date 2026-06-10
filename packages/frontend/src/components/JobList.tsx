import { useState, useEffect } from 'react'
import { JobCard } from './JobCard'

interface JobListProps {
  searchId: string
  onLoadMore: () => void
  isLoading: boolean
}

interface DisplayJob {
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

interface JobsResponse {
  jobs: Array<{
    _id: string
    title: string
    company: string
    description: string
    url: string
    salary?: string
    location: string
    matchScore?: number
    matchReasoning?: string
  }>
  page: number
  pageSize: number
  totalJobs: number
  totalPages: number
  isLoading: boolean
  hasMore: boolean
}

export function JobList({ searchId, onLoadMore, isLoading }: JobListProps) {
  const [jobs, setJobs] = useState<DisplayJob[]>([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [nextPageLoading, setNextPageLoading] = useState(false)
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

  // Fetch jobs for current page
  useEffect(() => {
    const fetchJobs = async () => {
      try {
        const token = getAuthToken()
        if (!token) {
          setError('Not authenticated')
          return
        }

        const response = await fetch(
          `/api/searches/${searchId}/jobs?page=${page}&pageSize=10`,
          {
            headers: {
              Authorization: `Bearer ${token}`
            }
          }
        )

        if (!response.ok) {
          throw new Error(`Failed to fetch jobs: ${response.statusText}`)
        }

        const data: JobsResponse = await response.json()

        if (page === 1) {
          // Replace jobs for first page
          setJobs(data.jobs.map(job => ({
            ...job,
            id: job._id,
            matchScore: job.matchScore ?? 0,
            matchReasoning: job.matchReasoning ?? ''
          })))
        } else {
          // Append jobs for subsequent pages
          setJobs(prev => [...prev, ...data.jobs.map(job => ({
            ...job,
            id: job._id,
            matchScore: job.matchScore ?? 0,
            matchReasoning: job.matchReasoning ?? ''
          }))])
        }

        setHasMore(data.hasMore)
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load jobs')
      }
    }

    fetchJobs()
  }, [searchId, page])

  // Pre-fetch next page in background
  useEffect(() => {
    if (!hasMore || nextPageLoading || isLoading) {
      return
    }

    const timeoutId = setTimeout(async () => {
      try {
        const token = getAuthToken()
        if (!token) return

        setNextPageLoading(true)

        // Just fetch to cache, don't update state
        await fetch(
          `/api/searches/${searchId}/jobs?page=${page + 1}&pageSize=10`,
          {
            headers: {
              Authorization: `Bearer ${token}`
            }
          }
        )
      } catch (err) {
        console.error('Failed to pre-fetch next page:', err)
      } finally {
        setNextPageLoading(false)
      }
    }, 1000)

    return () => clearTimeout(timeoutId)
  }, [searchId, page, hasMore, nextPageLoading, isLoading])

  const handleLoadMore = () => {
    onLoadMore()
    setPage(prev => prev + 1)
  }

  if (error && jobs.length === 0) {
    return (
      <div style={{ padding: '20px', backgroundColor: '#ffebee', borderRadius: '4px', color: '#c33' }}>
        <p>{error}</p>
      </div>
    )
  }

  return (
    <div>
      {jobs.length === 0 && !isLoading && (
        <div style={{ padding: '20px', textAlign: 'center', color: '#666' }}>
          <p>No jobs found yet. Keep searching...</p>
        </div>
      )}

      {jobs.map(job => (
        <JobCard key={job.id} job={job} />
      ))}

      {isLoading && (
        <div style={{
          padding: '20px',
          textAlign: 'center',
          color: '#666',
          fontStyle: 'italic'
        }}>
          Discovering more jobs...
        </div>
      )}

      {hasMore && (
        <button
          onClick={handleLoadMore}
          disabled={nextPageLoading || isLoading}
          style={{
            width: '100%',
            padding: '12px 20px',
            backgroundColor: nextPageLoading || isLoading ? '#ccc' : '#1976d2',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: nextPageLoading || isLoading ? 'not-allowed' : 'pointer',
            fontSize: '16px',
            fontWeight: 'bold',
            opacity: nextPageLoading || isLoading ? 0.5 : 1,
            transition: 'background-color 0.2s'
          }}
          onMouseEnter={(e) => {
            if (!nextPageLoading && !isLoading) {
              (e.target as HTMLButtonElement).style.backgroundColor = '#1565c0'
            }
          }}
          onMouseLeave={(e) => {
            if (!nextPageLoading && !isLoading) {
              (e.target as HTMLButtonElement).style.backgroundColor = '#1976d2'
            }
          }}
        >
          {nextPageLoading ? 'Loading...' : 'Load More Jobs'}
        </button>
      )}
    </div>
  )
}
