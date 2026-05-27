interface ProgressDisplayProps {
  status: 'running' | 'complete' | 'failed'
  iterationCount: number
  jobsFound: number
}

export function ProgressDisplay({ status, iterationCount, jobsFound }: ProgressDisplayProps) {
  if (status === 'running') {
    return (
      <div style={{ padding: '20px', backgroundColor: '#e3f2fd', borderRadius: '4px', marginBottom: '20px' }}>
        <p>🔍 Searching... (Iteration {iterationCount})</p>
        <p>Found {jobsFound} jobs so far</p>
      </div>
    )
  }

  if (status === 'failed') {
    return (
      <div style={{ padding: '20px', backgroundColor: '#ffebee', borderRadius: '4px', marginBottom: '20px' }}>
        <p>❌ Search failed. Please try again.</p>
      </div>
    )
  }

  return (
    <div style={{ padding: '20px', backgroundColor: '#f1f8e9', borderRadius: '4px', marginBottom: '20px' }}>
      <p>✅ Search complete! Found {jobsFound} jobs.</p>
    </div>
  )
}
