import { Router, Request, Response, NextFunction } from 'express'
import { authMiddleware } from '../auth/auth.controller.js'
import { SearchSessionModel, JobModel } from '../db/models.js'
import { addEvent } from '../events/queue.js'
import mongoose from 'mongoose'

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

    // Validate searchId is a valid MongoDB ObjectId
    if (!mongoose.Types.ObjectId.isValid(searchId)) {
      return res.status(404).json({ error: 'Search not found' })
    }

    const session = await SearchSessionModel.findOne({
      _id: new mongoose.Types.ObjectId(searchId),
      userId
    })

    if (!session) {
      return res.status(404).json({ error: 'Search not found' })
    }

    res.status(200).json({
      searchId: session._id.toString(),
      status: session.status,
      query: session.query,
      iterationCount: session.iterationCount,
      foundJobsCount: session.foundJobs ? session.foundJobs.length : 0,
      startedAt: session.startedAt
    })
  } catch (error) {
    next(error)
  }
})

router.get('/:searchId/jobs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).userId
    const { searchId } = req.params
    const page = Math.max(1, parseInt(req.query.page as string) || 1)
    const pageSize = Math.max(1, parseInt(req.query.pageSize as string) || 10)

    // Validate searchId is a valid MongoDB ObjectId
    if (!mongoose.Types.ObjectId.isValid(searchId)) {
      return res.status(404).json({ error: 'Search not found' })
    }

    const session = await SearchSessionModel.findOne({
      _id: new mongoose.Types.ObjectId(searchId),
      userId
    })

    if (!session) {
      return res.status(404).json({ error: 'Search not found' })
    }

    // Calculate pagination
    const skip = (page - 1) * pageSize
    const totalJobs = await JobModel.countDocuments({
      searchSessionId: searchId
    })
    const totalPages = Math.ceil(totalJobs / pageSize)

    // Fetch jobs with pagination, sorted by matchScore descending, then scoredAt descending
    const jobs = await JobModel.find({
      searchSessionId: searchId
    })
      .sort({ matchScore: -1, scoredAt: -1 })
      .skip(skip)
      .limit(pageSize)
      .lean()

    res.status(200).json({
      jobs,
      page,
      pageSize,
      totalJobs,
      totalPages,
      isLoading: session.status === 'running',
      hasMore: page < totalPages
    })
  } catch (error) {
    next(error)
  }
})

router.get('/:searchId/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).userId
    const { searchId } = req.params

    // Validate searchId is a valid MongoDB ObjectId
    if (!mongoose.Types.ObjectId.isValid(searchId)) {
      return res.status(404).json({ error: 'Search not found' })
    }

    const session = await SearchSessionModel.findOne({
      _id: new mongoose.Types.ObjectId(searchId),
      userId
    })

    if (!session) {
      return res.status(404).json({ error: 'Search not found' })
    }

    res.status(200).json({
      status: session.status,
      companiesDiscovered: session.companiesDiscovered,
      companiesCrawled: session.companiesCrawled,
      companiesRemaining: session.companiesRemaining,
      jobsExtracted: session.jobsExtracted,
      jobsScored: session.jobsScored,
      expandedSearch: session.expandedSearch,
      query: session.query,
      startedAt: session.startedAt,
      completedAt: session.completedAt
    })
  } catch (error) {
    next(error)
  }
})

export default router
