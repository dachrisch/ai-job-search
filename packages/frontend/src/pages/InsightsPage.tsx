import { useRef, useEffect } from 'react'
import { useInsights } from '../hooks/useInsights'

interface InsightsPageProps {
  searchId: string
  token: string
  onBack: () => void
}

export function InsightsPage({ searchId, token, onBack }: InsightsPageProps) {
  const { data, pipelineEvents, status, isConnected, loading, error } = useInsights(searchId, token)
  const timelineEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    timelineEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [pipelineEvents.length])

  if (loading) {
    return (
      <div className="container-wide">
        <div className="alert alert-info">Loading insights...</div>
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="container-wide">
        <div className="alert alert-error">
          <p>{error}</p>
          <button className="btn" onClick={onBack}>Back to search</button>
        </div>
      </div>
    )
  }

  return (
    <div className="container-wide">
      <div className="insights-header">
        <div>
          <h2 className="insights-title">Pipeline Insights</h2>
          <p className="insights-query">Query: {data?.query}</p>
        </div>
        <div className="insights-status-row">
          <span className={`status-badge status-badge--${status}`}>
            {status === 'running' && <span className="status-dot" />}
            {status}
          </span>
          {!isConnected && status === 'running' && (
            <span className="faint" style={{ fontSize: 13 }}>Reconnecting...</span>
          )}
        </div>
      </div>

      {/* Stats overview */}
      {data?.stats && (
        <div className="insights-stats">
          <StatCard label="Companies Found" value={data.stats.companiesDiscovered} />
          <StatCard label="Companies Crawled" value={data.stats.companiesCrawled} />
          <StatCard label="Jobs Extracted" value={data.stats.jobsExtracted} />
          <StatCard label="Jobs Scored" value={data.stats.jobsScored} />
          {data.stats.expandedSearch && <StatCard label="Expanded" value="Yes" />}
        </div>
      )}

      {/* Pipeline timeline */}
      <div className="insights-section">
        <h3 className="insights-section-title">Live Pipeline</h3>
        <div className="pipeline-timeline">
          {pipelineEvents.length === 0 && (
            <div className="pipeline-empty">Waiting for pipeline events...</div>
          )}
          {pipelineEvents.map((event, i) => (
            <PipelineEventCard key={i} event={event} />
          ))}
          <div ref={timelineEndRef} />
        </div>
      </div>

      {/* Conversation history (LLM prompts/responses) */}
      {data?.conversationHistory && data.conversationHistory.length > 0 && (
        <div className="insights-section">
          <h3 className="insights-section-title">LLM Conversation History</h3>
          <div className="conversation-list">
            {data.conversationHistory.map((entry, i) => (
              <div key={i} className={`conversation-entry conversation-entry--${entry.role}`}>
                <span className="conversation-role">{entry.role === 'user' ? 'Prompt' : 'Response'}</span>
                <pre className="conversation-content">{entry.content}</pre>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Discovered companies */}
      {data?.companies && data.companies.length > 0 && (
        <div className="insights-section">
          <h3 className="insights-section-title">Discovered Companies ({data.companies.length})</h3>
          <div className="company-list">
            {data.companies.map((company, i) => (
              <div key={i} className="company-card">
                <div className="company-card-header">
                  <span className="company-name">{company.name}</span>
                  <span className={`status-pill status-pill--${company.status}`}>{company.status}</span>
                </div>
                <div className="company-card-meta">
                  <span className="faint">{company.url}</span>
                  {company.hiddenGemScore !== undefined && (
                    <span className="gem-score">Gem: {company.hiddenGemScore}</span>
                  )}
                  {company.sizeBand && (
                    <span className="size-band">{company.sizeBand}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Search queries generated */}
      {data?.searchQueries && data.searchQueries.length > 0 && (
        <div className="insights-section">
          <h3 className="insights-section-title">Search Queries ({data.searchQueries.length})</h3>
          <div className="query-list">
            {data.searchQueries.map((q, i) => (
              <div key={i} className="query-item">{q}</div>
            ))}
          </div>
        </div>
      )}

      {/* Jobs found */}
      {data?.jobs && data.jobs.length > 0 && (
        <div className="insights-section">
          <h3 className="insights-section-title">Jobs Found ({data.jobs.length})</h3>
          <div className="jobs-table">
            <table>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Company</th>
                  <th>Score</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {data.jobs.sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0)).map((job, i) => (
                  <tr key={i}>
                    <td><a href={job.url} target="_blank" rel="noopener noreferrer">{job.title}</a></td>
                    <td>{job.company}</td>
                    <td>{job.matchScore ?? '-'}</td>
                    <td><span className="faint">{job.discoveryMethod}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="stat-card">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  )
}

function PipelineEventCard({ event }: { event: any }) {
  const typeIcons: Record<string, string> = {
    info: 'i',
    query: 'q',
    prompt: 'p',
    response: 'r',
    result: 'check',
    error: '!',
  }

  const time = new Date(event.timestamp).toLocaleTimeString()

  return (
    <div className={`pipeline-event pipeline-event--${event.type}`}>
      <div className="pipeline-event-dot" />
      <div className="pipeline-event-body">
        <div className="pipeline-event-header">
          <span className="pipeline-event-time">{time}</span>
          <span className={`pipeline-event-type pipeline-event-type--${event.type}`}>
            {event.type}
          </span>
          <span className="pipeline-event-step">{event.step}</span>
        </div>
        <div className="pipeline-event-label">{event.label}</div>
        {event.detail && (
          <pre className="pipeline-event-detail">{event.detail}</pre>
        )}
        {event.metadata && Object.keys(event.metadata).length > 0 && (
          <details className="pipeline-event-meta">
            <summary>Metadata</summary>
            <pre>{JSON.stringify(event.metadata, null, 2)}</pre>
          </details>
        )}
      </div>
    </div>
  )
}
