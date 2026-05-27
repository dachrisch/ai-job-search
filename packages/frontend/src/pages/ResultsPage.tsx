import { useState, useEffect } from 'react'
import { ProgressDisplay } from '../components/ProgressDisplay'
import { JobCard } from '../components/JobCard'
import { useApi } from '../hooks/useApi'

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
  const { getSearchStatus, getSearchResults } = useApi(token)
  const [status, setStatus] = useState<'running' | 'complete' | 'failed'>('running')
  const [iterationCount, setIterationCount] = useState(0)
  const [jobs, setJobs] = useState<Job[]>([])

  useEffect(() => {
    const poll = async () => {
      try {
        const statusData = await getSearchStatus(searchId)
        setStatus(statusData.status)
        setIterationCount(statusData.iterationCount)

        if (statusData.status === 'complete') {
          const results = await getSearchResults(searchId)
          setJobs(results)
        }
      } catch (error) {
        console.error('Failed to fetch status:', error)
      }
    }

    const interval = setInterval(poll, 2000)
    poll()

    return () => clearInterval(interval)
  }, [searchId, getSearchStatus, getSearchResults])

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '40px 20px' }}>
      <button onClick={onBack} style={{ marginBottom: '20px' }}>← Back to Search</button>
      <h1>Search Results</h1>
      <ProgressDisplay status={status} iterationCount={iterationCount} jobsFound={jobs.length} />
      {jobs.map(job => <JobCard key={job.id} job={job} />)}
    </div>
  )
}
