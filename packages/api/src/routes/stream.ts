import { Router, Request, Response, NextFunction } from 'express'
import { authMiddleware } from '../auth/auth.controller.js'
import { SearchSessionModel, JobModel } from '../db/models.js'
import { SSEManager } from '../utils/SSEManager.js'

export async function handleStreamConnect(
  req: Request,
  res: Response,
  next: NextFunction,
  sseManager: SSEManager
) {
  try {
    const userId = (req as any).userId
    const { searchId } = req.params

    // Verify search exists and user owns it
    const session = await SearchSessionModel.findById(searchId)
    if (!session) {
      return res.status(404).json({ error: 'Search not found' })
    }

    if (session.userId !== userId) {
      return res.status(403).json({ error: 'Access denied' })
    }

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')

    // Subscribe client to SSE manager
    sseManager.subscribe(searchId, res)

    // Fetch current jobs for sync event
    const jobs = await JobModel.find({ searchSessionId: searchId })
    const syncPayload = {
      status: session.status,
      iterationCount: session.iterationCount,
      jobs: jobs.map(job => ({
        id: job._id.toString(),
        title: job.title,
        company: job.company,
        description: job.description,
        url: job.url,
        salary: job.salary,
        location: job.location,
        matchScore: job.matchScore || 0,
        matchReasoning: job.matchReasoning || ''
      })),
      sitesSearched: session.sitesSearched || []
    }

    // Send initial sync event
    res.write(`data: ${JSON.stringify({ type: 'sync', payload: syncPayload })}\n\n`)

    // Start heartbeat to keep connection alive
    const heartbeat = setInterval(() => {
      res.write('data: {"type":"ping"}\n\n')
    }, 30000)

    // Cleanup on disconnect
    res.on('close', () => {
      clearInterval(heartbeat)
      sseManager.unsubscribe(searchId, res)
    })
  } catch (error) {
    next(error)
  }
}

export function streamRouter(sseManager: SSEManager) {
  const router = Router()

  router.use(authMiddleware)

  router.get('/:searchId/stream', (req: Request, res: Response, next: NextFunction) => {
    return handleStreamConnect(req, res, next, sseManager)
  })

  return router
}
