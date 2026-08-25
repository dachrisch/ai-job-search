import { Router, Request, Response, NextFunction } from 'express'
import { authMiddleware } from '../auth/auth.controller.js'
import { SearchSessionModel, CompanyModel, JobModel } from '../db/models.js'
import mongoose from 'mongoose'

const router = Router()

router.use(authMiddleware)

router.get('/:searchId/insights', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).userId
    const searchId = req.params.searchId as string

    if (!mongoose.Types.ObjectId.isValid(searchId)) {
      return res.status(404).json({ error: 'Search not found' })
    }

    const session = await SearchSessionModel.findOne({
      _id: new mongoose.Types.ObjectId(searchId),
      userId
    } as any)

    if (!session) {
      return res.status(404).json({ error: 'Search not found' })
    }

    const companies = await CompanyModel.find({
      searchQuery: session.query
    }).select('url name status hiddenGemScore sizeBand confidence discoveredFrom')

    const jobs = await JobModel.find({
      searchSessionId: searchId
    }).select('title company url matchScore matchReasoning keywordMatchScore keywordMatchReasoning discoveryMethod')

    res.status(200).json({
      searchId: session._id.toString(),
      query: session.query,
      status: session.status,
      startedAt: session.startedAt,
      completedAt: session.completedAt,
      pipelineEvents: session.pipelineEvents || [],
      conversationHistory: session.conversationHistory || [],
      searchQueries: session.searchQueries || [],
      discoveredPages: session.discoveredPages || [],
      companies: companies.map(c => ({
        url: c.url,
        name: c.name,
        status: c.status,
        hiddenGemScore: c.hiddenGemScore,
        sizeBand: c.sizeBand,
        confidence: c.confidence,
        discoveredFrom: c.discoveredFrom,
      })),
      stats: {
        companiesDiscovered: session.companiesDiscovered,
        companiesCrawled: session.companiesCrawled,
        companiesRemaining: session.companiesRemaining,
        jobsExtracted: session.jobsExtracted,
        jobsScored: session.jobsScored,
        expandedSearch: session.expandedSearch,
      },
      jobs: jobs.map(j => ({
        title: j.title,
        company: j.company,
        url: j.url,
        matchScore: j.matchScore,
        matchReasoning: j.matchReasoning,
        keywordMatchScore: j.keywordMatchScore,
        keywordMatchReasoning: j.keywordMatchReasoning,
        discoveryMethod: j.discoveryMethod,
      })),
    })
  } catch (error) {
    next(error)
  }
})

export default router
