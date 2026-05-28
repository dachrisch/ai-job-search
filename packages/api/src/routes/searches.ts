import { Router, Request, Response, NextFunction } from 'express'
import { authMiddleware } from '../auth/auth.controller.js'
import { SearchSessionModel, JobModel } from '../db/models.js'
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

router.get('/:searchId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).userId
    const { searchId } = req.params

    const session = await SearchSessionModel.findById(searchId)
    if (!session) {
      return res.status(404).json({ error: 'Search not found' })
    }

    if (session.userId !== userId) {
      return res.status(403).json({ error: 'Access denied' })
    }

    res.status(200).json({
      searchId: session._id.toString(),
      status: session.status,
      query: session.query,
      iterationCount: session.iterationCount,
      foundJobsCount: session.foundJobs.length
    })
  } catch (error) {
    next(error)
  }
})

router.get('/:searchId/jobs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).userId
    const { searchId } = req.params

    const session = await SearchSessionModel.findById(searchId)
    if (!session) {
      return res.status(404).json({ error: 'Search not found' })
    }

    if (session.userId !== userId) {
      return res.status(403).json({ error: 'Access denied' })
    }

    const jobs = await JobModel.find({ searchSessionId: searchId })

    const ranked = jobs.map(job => ({
      id: job._id.toString(),
      title: job.title,
      company: job.company,
      description: job.description,
      url: job.url,
      salary: job.salary,
      location: job.location,
      matchScore: job.matchScore || 0,
      matchReasoning: job.matchReasoning || ''
    }))

    ranked.sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0))

    res.status(200).json({ jobs: ranked })
  } catch (error) {
    next(error)
  }
})

export default router
