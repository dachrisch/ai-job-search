import { Router, Request, Response, NextFunction } from 'express'
import { authMiddleware } from '../auth/auth.controller.js'
import { SearchSessionModel } from '../db/models.js'
import { addEvent } from '../events/queue.js'

const router = Router()

router.use(authMiddleware)

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).userId
    const { query } = req.body

    if (!query) {
      return res.status(400).json({ error: 'Query required' })
    }

    const session = await SearchSessionModel.create({
      userId,
      query,
      status: 'running',
      claudeConversationHistory: [],
      foundJobs: [],
      sitesSearched: [],
      iterationCount: 0,
      startedAt: new Date()
    })

    // Fire-and-forget: add event to queue without blocking the response
    addEvent('search_started', {
      searchId: session._id.toString(),
      userId,
      query
    }).catch(error => {
      console.error('Failed to queue search_started event:', error)
    })

    res.status(201).json({
      searchId: session._id.toString(),
      status: session.status
    })
  } catch (error) {
    next(error)
  }
})

export default router
