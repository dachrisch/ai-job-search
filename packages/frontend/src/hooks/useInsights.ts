import { useState, useEffect, useCallback, useRef } from 'react'

interface PipelineEvent {
  timestamp: string
  step: string
  type: 'info' | 'query' | 'prompt' | 'response' | 'result' | 'error'
  label: string
  detail?: string
  metadata?: Record<string, unknown>
}

interface InsightsData {
  searchId: string
  query: string
  status: 'running' | 'complete' | 'failed'
  startedAt: string
  completedAt?: string
  pipelineEvents: PipelineEvent[]
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>
  searchQueries: string[]
  discoveredPages: string[]
  companies: Array<{
    url: string
    name: string
    status: string
    hiddenGemScore?: number
    sizeBand?: string
    confidence?: string
    discoveredFrom?: string
  }>
  stats: {
    companiesDiscovered: number
    companiesCrawled: number
    companiesRemaining: number
    jobsExtracted: number
    jobsScored: number
    expandedSearch: boolean
  }
  jobs: Array<{
    title: string
    company: string
    url: string
    matchScore?: number
    matchReasoning?: string
    keywordMatchScore?: number
    keywordMatchReasoning?: string
    discoveryMethod?: string
  }>
}

interface UseInsightsReturn {
  data: InsightsData | null
  pipelineEvents: PipelineEvent[]
  status: 'running' | 'complete' | 'failed'
  isConnected: boolean
  loading: boolean
  error: string | null
}

export function useInsights(searchId: string, token: string): UseInsightsReturn {
  const [data, setData] = useState<InsightsData | null>(null)
  const [pipelineEvents, setPipelineEvents] = useState<PipelineEvent[]>([])
  const [status, setStatus] = useState<'running' | 'complete' | 'failed'>('running')
  const [isConnected, setIsConnected] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)

  // Fetch initial insights data from REST
  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch(`/api/searches/${searchId}/insights`, {
          headers: { Authorization: `Bearer ${token}` }
        })
        if (!response.ok) throw new Error('Failed to fetch insights')
        const result: InsightsData = await response.json()
        setData(result)
        setPipelineEvents(result.pipelineEvents || [])
        setStatus(result.status)
        setLoading(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load insights')
        setLoading(false)
      }
    }
    fetchData()
  }, [searchId, token])

  // SSE for real-time pipeline events
  const connect = useCallback(() => {
    try {
      const es = new EventSource(`/api/searches/${searchId}/stream?token=${encodeURIComponent(token)}`, {
        withCredentials: false
      })

      es.addEventListener('message', (event: MessageEvent) => {
        try {
          const msg = JSON.parse(event.data)

          if (msg.type === 'sync') {
            setIsConnected(true)
            setError(null)
            if (msg.payload.pipelineEvents) {
              setPipelineEvents(msg.payload.pipelineEvents)
            }
          } else if (msg.type === 'pipeline_event') {
            setPipelineEvents(prev => [...prev, msg.payload])
          } else if (msg.type === 'status') {
            setStatus(msg.payload.status)
          } else if (msg.type === 'error') {
            setStatus('failed')
          }
        } catch {
          // ignore parse errors
        }
      })

      es.addEventListener('open', () => {
        setIsConnected(true)
        setError(null)
      })

      es.addEventListener('error', () => {
        setIsConnected(false)
        es.close()
        eventSourceRef.current = null
      })

      eventSourceRef.current = es
    } catch {
      setError('Failed to connect to pipeline stream')
    }
  }, [searchId, token])

  useEffect(() => {
    connect()
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
      }
    }
  }, [searchId, token])

  return { data, pipelineEvents, status, isConnected, loading, error }
}
