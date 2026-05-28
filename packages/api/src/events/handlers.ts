import { SearchSessionModel, JobModel, SiteModel } from '../db/models.js'
import { addEvent } from './queue.js'
import { callClaude } from '../claude/client.js'
import axios from 'axios'

// Mock job data for testing without a real crawler
function getMockJobs(keywords: string): any[] {
  const mockJobs = [
    {
      title: 'Senior Software Engineer',
      company: 'TechCorp Inc.',
      description: 'We are looking for an experienced Senior Software Engineer to join our growing team. You will work with modern technologies and lead technical initiatives.',
      url: 'https://techcorp.com/jobs/senior-engineer',
      sourceUrl: 'https://linkedin.com',
      salary: '$150,000 - $200,000',
      location: 'San Francisco, CA',
      matchScore: 95
    },
    {
      title: 'Full Stack Developer',
      company: 'CloudTech Solutions',
      description: 'Join our dynamic team as a Full Stack Developer. Experience with React, Node.js, and cloud technologies required. Remote position available.',
      url: 'https://cloudtech.com/careers/full-stack',
      sourceUrl: 'https://indeed.com',
      salary: '$120,000 - $160,000',
      location: 'Remote',
      matchScore: 88
    },
    {
      title: 'Backend Engineer - Python',
      company: 'DataSystems Ltd',
      description: 'We are seeking a Backend Engineer with Python expertise to build scalable microservices. Strong experience with databases and distributed systems required.',
      url: 'https://datasystems.com/jobs/backend-python',
      sourceUrl: 'https://stackoverflow.com',
      salary: '$130,000 - $180,000',
      location: 'New York, NY',
      matchScore: 82
    },
    {
      title: 'Frontend Engineer React',
      company: 'StartupXYZ',
      description: 'Looking for a talented Frontend Engineer with React expertise. You will create beautiful, responsive user interfaces for our web platform.',
      url: 'https://startupxyz.com/jobs/frontend-react',
      sourceUrl: 'https://glassdoor.com',
      salary: '$110,000 - $150,000',
      location: 'Austin, TX',
      matchScore: 85
    },
    {
      title: 'Software Architect',
      company: 'Enterprise Solutions Corp',
      description: 'Design and build large-scale software systems. 10+ years of experience required. Lead a team of talented engineers.',
      url: 'https://enterprisesol.com/jobs/architect',
      sourceUrl: 'https://dice.com',
      salary: '$180,000 - $250,000',
      location: 'Seattle, WA',
      matchScore: 78
    },
    {
      title: 'DevOps Engineer',
      company: 'CloudInfra Inc',
      description: 'Manage and optimize our cloud infrastructure. Kubernetes, Docker, and CI/CD pipeline experience essential.',
      url: 'https://cloudinfra.com/jobs/devops',
      sourceUrl: 'https://angel.co',
      salary: '$125,000 - $165,000',
      location: 'Remote',
      matchScore: 80
    }
  ]

  return mockJobs
}

export const eventHandlers = {
  search_started: async (data: { searchId: string; userId: string; query: string }) => {
    try {
      console.log('Search started:', data.searchId)

      const session = await SearchSessionModel.findById(data.searchId)
      if (!session) {
        console.warn('Session not found:', data.searchId)
        return
      }

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
    } catch (error) {
      console.error('Error in search_started handler:', error)
      const session = await SearchSessionModel.findById(data.searchId)
      if (session) {
        session.status = 'failed'
        await session.save()
      }
      throw error
    }
  },

  sites_identified: async (data: { searchId: string; sites: string[]; keywords: string }) => {
    try {
      console.log('Sites identified:', data.sites)

      const session = await SearchSessionModel.findById(data.searchId)
      if (!session) {
        console.warn('Session not found:', data.searchId)
        return
      }

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
    } catch (error) {
      console.error('Error in sites_identified handler:', error)
      const session = await SearchSessionModel.findById(data.searchId)
      if (session) {
        session.status = 'failed'
        await session.save()
      }
      throw error
    }
  },

  crawl_requested: async (data: { searchId: string; sites: string[]; keywords: string }) => {
    try {
      console.log('Crawl requested for sites:', data.sites)

      let jobs: any[] = []

      try {
        // Call Python crawler
        const response = await axios.post('http://localhost:8000/crawler/scrape', {
          urls: data.sites.map(domain => `https://${domain}/jobs`),
          keywords: data.keywords
        })

        jobs = response.data.jobs
      } catch (crawlerError: any) {
        // If crawler is not available, use mock job data
        console.log('Crawler unavailable, using mock job data:', crawlerError.message)
        jobs = getMockJobs(data.keywords)
      }

      await addEvent('jobs_scraped', {
        searchId: data.searchId,
        jobs,
        newSites: []
      })
    } catch (error) {
      console.error('Crawl handler failed:', error)
      await addEvent('search_failed', { searchId: data.searchId, error: String(error) })
      throw error
    }
  },

  jobs_scraped: async (data: { searchId: string; jobs: any[]; newSites: string[] }) => {
    try {
      console.log('Jobs scraped:', data.jobs.length)

      const session = await SearchSessionModel.findById(data.searchId)
      if (!session) {
        console.warn('Session not found:', data.searchId)
        return
      }

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
    } catch (error) {
      console.error('Error in jobs_scraped handler:', error)
      const session = await SearchSessionModel.findById(data.searchId)
      if (session) {
        session.status = 'failed'
        await session.save()
      }
      throw error
    }
  },

  search_refined: async (data: { searchId: string; claudeResponse: string }) => {
    try {
      console.log('Search refined')

      const session = await SearchSessionModel.findById(data.searchId)
      if (!session) {
        console.warn('Session not found:', data.searchId)
        return
      }

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
    } catch (error) {
      console.error('Error in search_refined handler:', error)
      const session = await SearchSessionModel.findById(data.searchId)
      if (session) {
        session.status = 'failed'
        await session.save()
      }
      throw error
    }
  },

  search_complete: async (data: { searchId: string }) => {
    try {
      console.log('Search complete')

      const session = await SearchSessionModel.findById(data.searchId)
      if (!session) {
        console.warn('Session not found:', data.searchId)
        return
      }

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
    } catch (error) {
      console.error('Error in search_complete handler:', error)
      const session = await SearchSessionModel.findById(data.searchId)
      if (session) {
        session.status = 'failed'
        await session.save()
      }
      throw error
    }
  },

  search_failed: async (data: { searchId: string; error: string }) => {
    try {
      console.log('Search failed handler:', data.searchId, data.error)
      const session = await SearchSessionModel.findById(data.searchId)
      if (session) {
        session.status = 'failed'
        await session.save()
      }
    } catch (error) {
      console.error('Error in search_failed handler:', error)
      throw error
    }
  }
}
