interface SearchProgressProps {
  companiesDiscovered: number
  companiesCrawled: number
  companiesRemaining: number
  jobsExtracted: number
  jobsScored: number
}

export function SearchProgress({ companiesDiscovered, companiesCrawled, companiesRemaining, jobsExtracted, jobsScored }: SearchProgressProps) {
  return (
    <div className="card">
      <div>
        <ProgressItem
          label="Companies Discovered"
          value={companiesDiscovered}
        />
        <ProgressItem
          label="Companies Crawled"
          value={companiesCrawled}
        />
        <ProgressItem
          label="Jobs Extracted"
          value={jobsExtracted}
        />
        <ProgressItem
          label="Jobs Scored"
          value={jobsScored}
        />
      </div>

      {companiesRemaining > 0 && (
        <div className="alert alert-info" style={{ marginTop: 12 }}>
          {companiesRemaining} companies remaining to crawl
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
