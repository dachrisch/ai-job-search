interface StatusLineProps {
  status: 'running' | 'complete' | 'failed'
  jobsFound: number
  onRetry: () => void
}

export function StatusLine({ status, jobsFound, onRetry }: StatusLineProps) {
  if (status === 'failed') {
    return (
      <div className="alert alert-error" style={{ display: 'inline-flex', gap: 12, alignItems: 'center' }}>
        <span>Search failed.</span>
        <button className="btn" onClick={onRetry}>Retry</button>
      </div>
    )
  }

  if (status === 'running') {
    return (
      <span className="status-line"><span className="status-dot" /> Finding matches… {jobsFound} so far</span>
    )
  }

  return <span className="status-line">{jobsFound} results</span>
}
