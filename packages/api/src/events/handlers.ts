import { SearchSessionModel, JobModel, SiteModel } from '../db/models'
import { addEvent } from './queue'
import { callClaude } from '../claude/client'
import axios from 'axios'

export const eventHandlers = {
  search_started: async (data: { searchId: string; userId: string; query: string }) => {
    console.log('Search started:', data.searchId)

    const session = await SearchSessionModel.findById(data.searchId)
    if (!session) return

    // Call Claude to get initial site suggestions
    const suggestion = await callClaude(
      session.userId,
      `Given the user wants: "${data.query}", what 3-5 job board websites should we search?
       Return JSON: {sites: ["domain1.com", "domain2.com"], keywords: "search keywords"}`
    )

    const parsed = JSON.parse(suggestion)
    session.claudeConversationHistory.push(
      { role: 'user', content: data.query },
      { role: 'assistant', content: suggestion }
    )
    await session.save()

    await addEvent('sites_identified', {
      searchId: data.searchId,
      sites: parsed.sites,
      keywords: parsed.keywords
    })
  },

  sites_identified: async (data: { searchId: string; sites: string[]; keywords: string }) => {
    console.log('Sites identified:', data.sites)

    const session = await SearchSessionModel.findById(data.searchId)
    if (!session) return

    // Create Site records for new sites
    for (const domain of data.sites) {
      await SiteModel.findOneAndUpdate(
        { domain },
        { domain, jobBoardUrl: `https://${domain}/jobs`, discoveryMethod: 'searxng_search' },
        { upsert: true }
      )
    }

    // Request crawler to scrape sites
    await addEvent('crawl_requested', {
      searchId: data.searchId,
      sites: data.sites,
      keywords: data.keywords
    })
  },

  crawl_requested: async (data: { searchId: string; sites: string[]; keywords: string }) => {
    console.log('Crawl requested for sites:', data.sites)

    try {
      // Call Python crawler
      const response = await axios.post('http://localhost:8000/crawler/scrape', {
        urls: data.sites.map(domain => `https://${domain}/jobs`),
        keywords: data.keywords
      })

      await addEvent('jobs_scraped', {
        searchId: data.searchId,
        jobs: response.data.jobs,
        newSites: response.data.newSites || []
      })
    } catch (error) {
      console.error('Crawler failed:', error)
      await addEvent('search_failed', { searchId: data.searchId, error: String(error) })
    }
  },

  jobs_scraped: async (data: { searchId: string; jobs: any[]; newSites: string[] }) => {
    console.log('Jobs scraped:', data.jobs.length)

    const session = await SearchSessionModel.findById(data.searchId)
    if (!session) return

    // Store jobs in database
    for (const job of data.jobs) {
      await JobModel.create({
        ...job,
        searchSessionId: data.searchId,
        discoveredAt: new Date()
      })
    }

    session.foundJobs.push(...(await JobModel.find({ searchSessionId: data.searchId }).select('_id')).map(j => j._id.toString()))
    session.iterationCount += 1
    await session.save()

    // Ask Claude if we should search more
    const jobSummary = data.jobs.map(j => `${j.title} at ${j.company}`).join('\n')
    const prompt = `We found ${data.jobs.length} jobs so far:\n${jobSummary}\n\nShould we search more sites, or do we have good coverage?`

    const claudeResponse = await callClaude(session.userId, prompt)
    session.claudeConversationHistory.push(
      { role: 'user', content: prompt },
      { role: 'assistant', content: claudeResponse }
    )
    await session.save()

    if (claudeResponse.toLowerCase().includes('more') || claudeResponse.toLowerCase().includes('try')) {
      await addEvent('search_refined', {
        searchId: data.searchId,
        claudeResponse
      })
    } else {
      await addEvent('search_complete', {
        searchId: data.searchId
      })
    }
  },

  search_refined: async (data: { searchId: string; claudeResponse: string }) => {
    console.log('Search refined')

    const session = await SearchSessionModel.findById(data.searchId)
    if (!session) return

    // Extract new sites from Claude response
    const prompt = `From your previous response, please extract the specific websites to search next in JSON format: {sites: ["domain.com"]}`
    const response = await callClaude(session.userId, prompt)
    const parsed = JSON.parse(response)

    session.claudeConversationHistory.push(
      { role: 'user', content: prompt },
      { role: 'assistant', content: response }
    )
    await session.save()

    await addEvent('sites_identified', {
      searchId: data.searchId,
      sites: parsed.sites,
      keywords: session.query
    })
  },

  search_complete: async (data: { searchId: string }) => {
    console.log('Search complete')

    const session = await SearchSessionModel.findById(data.searchId)
    if (!session) return

    // Get all jobs for this search
    const jobs = await JobModel.find({ searchSessionId: data.searchId })

    // Ask Claude to rank and score jobs
    const jobDetails = jobs.map(j => `${j.title} at ${j.company} in ${j.location}`).join('\n')
    const rankingPrompt = `Rank these jobs by how well they match "${session.query}". For each, give a score 0-100 and brief reasoning:\n${jobDetails}`

    const ranking = await callClaude(session.userId, rankingPrompt)

    // Parse ranking and update jobs (simplified parsing)
    session.claudeConversationHistory.push(
      { role: 'user', content: rankingPrompt },
      { role: 'assistant', content: ranking }
    )
    session.status = 'complete'
    session.completedAt = new Date()
    await session.save()

    console.log('Search session complete:', data.searchId)
  },

  search_failed: async (data: { searchId: string; error: string }) => {
    const session = await SearchSessionModel.findById(data.searchId)
    if (session) {
      session.status = 'failed'
      await session.save()
    }
  }
}
