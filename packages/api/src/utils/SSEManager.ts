import { Response } from 'express'

interface SSEEvent {
  type: 'sync' | 'status' | 'job' | 'ping' | 'error'
  payload: Record<string, unknown>
}

class SSEManager {
  private clients: Map<string, Set<Response>> = new Map()

  subscribe(searchId: string, res: Response): void {
    if (!this.clients.has(searchId)) {
      this.clients.set(searchId, new Set())
    }
    this.clients.get(searchId)!.add(res)

    // Clean up on disconnect - use once() to prevent duplicate listeners
    res.once('close', () => {
      this.unsubscribe(searchId, res)
    })
  }

  unsubscribe(searchId: string, res: Response): void {
    const clients = this.clients.get(searchId)
    if (clients) {
      clients.delete(res)
      if (clients.size === 0) {
        this.clients.delete(searchId)
      }
    }
  }

  broadcast(searchId: string, event: SSEEvent): void {
    const clients = this.clients.get(searchId)
    if (!clients) return

    const message = `data: ${JSON.stringify(event)}\n\n`
    clients.forEach(res => {
      try {
        res.write(message)
      } catch (error) {
        console.error(`[SSEManager] Error broadcasting to client for search ${searchId}:`, error)
        this.unsubscribe(searchId, res)
      }
    })
  }

  getConnectedClientCount(searchId: string): number {
    return this.clients.get(searchId)?.size ?? 0
  }
}

export { SSEManager, SSEEvent }
