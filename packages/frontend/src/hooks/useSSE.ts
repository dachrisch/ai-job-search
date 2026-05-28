import { useState, useEffect, useCallback, useRef } from 'react'

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

interface SSEPayload {
  type: 'sync' | 'status' | 'job' | 'ping' | 'error'
  payload: any
}

interface UseSSEReturn {
  status: 'running' | 'complete' | 'failed'
  iterationCount: number
  jobs: Job[]
  sitesSearched: string[]
  isConnected: boolean
  error: string | null
}

export function useSSE(searchId: string, token: string): UseSSEReturn {
  const [status, setStatus] = useState<'running' | 'complete' | 'failed'>('running')
  const [iterationCount, setIterationCount] = useState(0)
  const [jobs, setJobs] = useState<Job[]>([])
  const [sitesSearched, setSitesSearched] = useState<string[]>([])
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reconnectAttempts, setReconnectAttempts] = useState(0)
  const eventSourceRef = useRef<EventSource | null>(null)

  const connect = useCallback(() => {
    try {
      const es = new EventSource(`/api/searches/${searchId}/stream?token=${encodeURIComponent(token)}`, {
        withCredentials: false
      })

      es.addEventListener('message', (event: MessageEvent) => {
        try {
          const data: SSEPayload = JSON.parse(event.data)

          switch (data.type) {
            case 'sync':
              setStatus(data.payload.status)
              setIterationCount(data.payload.iterationCount)
              setJobs(data.payload.jobs || [])
              setSitesSearched(data.payload.sitesSearched || [])
              setIsConnected(true)
              setError(null)
              setReconnectAttempts(0)
              break

            case 'status':
              setStatus(data.payload.status)
              setIterationCount(data.payload.iterationCount)
              break

            case 'job':
              setJobs(prev => [...prev, data.payload.job])
              break

            case 'error':
              setStatus('failed')
              setError(data.payload.message)
              break

            case 'ping':
              // Heartbeat, no action needed
              break
          }
        } catch (parseError) {
          console.error('Failed to parse SSE message:', parseError)
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
        setError('Connection lost. Attempting to reconnect...')

        // Exponential backoff: 1s, 2s, 4s, 8s, 8s
        const nextAttempt = reconnectAttempts + 1
        const delay = Math.min(1000 * Math.pow(2, nextAttempt - 1), 8000)

        if (nextAttempt < 5) {
          setReconnectAttempts(nextAttempt)
          setTimeout(connect, delay)
        } else {
          setError('Failed to connect to search stream. Click reconnect to try again.')
        }
      })

      eventSourceRef.current = es
    } catch (err) {
      setError('Failed to connect to search stream')
      setIsConnected(false)
    }
  }, [searchId, token, reconnectAttempts])

  useEffect(() => {
    connect()

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
      }
    }
  }, [searchId, token])

  return {
    status,
    iterationCount,
    jobs,
    sitesSearched,
    isConnected,
    error
  }
}
