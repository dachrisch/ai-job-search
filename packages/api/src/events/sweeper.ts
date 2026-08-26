import { SearchSessionModel } from '../db/models.js'
import { SSEManager } from '../utils/SSEManager.js'

// How long a search is allowed to stay `running` before it is considered stuck.
// Discovery + crawling + scoring routinely take 10-20 minutes; the deadline is a
// safety net so users never see an eternal spinner.
const STALE_SEARCH_TIMEOUT_MS = Number(process.env.SEARCH_DEADLINE_MS || 30 * 60 * 1000)
const SWEEP_INTERVAL_MS = Number(process.env.SWEEP_INTERVAL_MS || 5 * 60 * 1000)

/**
 * Finds `running` sessions that have exceeded the per-search deadline and marks
 * them `failed` with a stored reason, broadcasting an SSE error so connected
 * clients learn the search is over.
 */
export async function sweepStuckSearches(sseManager: SSEManager | null): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_SEARCH_TIMEOUT_MS)
  let stuck: any[] = []
  try {
    stuck = await SearchSessionModel.find({
      status: 'running',
      startedAt: { $lt: cutoff },
    })
  } catch (err) {
    console.error('[sweeper] Failed to query running sessions:', err)
    return 0
  }

  let marked = 0
  for (const session of stuck) {
    const searchId = session._id.toString()
    const reason = `Search exceeded the ${Math.round(STALE_SEARCH_TIMEOUT_MS / 60000)}-minute deadline`
    console.warn(`[sweeper] Marking stuck search ${searchId} as failed: ${reason}`)
    try {
      session.status = 'failed'
      session.failureReason = reason
      await session.save()
      marked++
    } catch (err) {
      console.error(`[sweeper] Failed to update session ${searchId}:`, err)
      continue
    }

    if (sseManager) {
      sseManager.broadcast(searchId, {
        type: 'error',
        payload: { message: reason, searchStatus: 'failed' },
      })
      sseManager.broadcast(searchId, {
        type: 'status',
        payload: { status: 'failed' },
      })
    }
  }
  return marked
}

/**
 * Periodically sweeps stuck `running` sessions. Returns the interval so callers
 * can clear it (and so tests don't leak timers).
 */
export function startSweeper(sseManager: SSEManager | null): NodeJS.Timeout {
  const interval = setInterval(() => {
    sweepStuckSearches(sseManager).catch(err => {
      console.error('[sweeper] Unexpected error during sweep:', err)
    })
  }, SWEEP_INTERVAL_MS)
  interval.unref?.()
  // Run once shortly after startup so stale sessions don't wait for the first tick.
  setTimeout(() => {
    sweepStuckSearches(sseManager).catch(err => {
      console.error('[sweeper] Unexpected error during startup sweep:', err)
    })
  }, 5000).unref?.()
  return interval
}