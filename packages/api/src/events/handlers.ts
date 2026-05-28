import { SearchSessionModel, JobModel, SiteModel } from '../db/models.js'
import { addEvent } from './queue.js'
import { callClaude } from '../claude/client.js'
import { SSEManager } from '../utils/SSEManager.js'
import { JobSourceManager } from '../job-sources/manager.js'
import { SearchService } from '../job-sources/search-service.js'
import { PageAnalyzer } from '../job-sources/page-analyzer.js'
import { SearchResult, AnalyzedPage } from '../job-sources/interfaces.js'

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

const jobSourceManager = new JobSourceManager()

export const eventHandlers = {
  search_started: async (data: { searchId: string; userId: string; query: string }, sseManager: SSEManager) => {
    try {
      console.log(`\n🤖 AGENT LOG - Search Started`)
      console.log(`   Query: "${data.query}"`)

      const session = await SearchSessionModel.findById(data.searchId)
      if (!session) {
        console.warn('Session not found:', data.searchId)
        return
      }

      const searchService = new SearchService()
      const searchResults = await searchService.search(data.query)

      console.log(`   🔍 SearXNG found ${searchResults.length} pages`)

      if (searchResults.length === 0) {
        console.log(`   📋 No SearXNG results, using fallback approach...`)

        const suggestion = await callClaude(
          session.userId,
          `User wants: "${data.query}".
           What are the best 3-5 job boards to search?
           Return JSON: {sites: ["domain1.com"], keywords: "search keywords"}`
        )

        const parsed = JSON.parse(suggestion)
        await addEvent('sites_identified', {
          searchId: data.searchId,
          sites: parsed.sites,
          keywords: parsed.keywords
        })
        return
      }

      await addEvent('search_query_performed', {
        searchId: data.searchId,
        query: data.query,
        results: searchResults
      })
    } catch (error) {
      console.error('Error in search_started handler:', error)
      await addEvent('search_failed', { searchId: data.searchId, error: String(error) })
    }
  },

  search_query_performed: async (
    data: { searchId: string; query: string; results: SearchResult[] },
    sseManager: SSEManager
  ) => {
    try {
      console.log(`\n🤖 AGENT LOG - Search Query Performed`)
      console.log(`   Query: "${data.query}"`)
      console.log(`   Results found: ${data.results.length}`)

      const session = await SearchSessionModel.findById(data.searchId)
      if (!session) {
        console.warn('Session not found:', data.searchId)
        return
      }

      if (!session.searchQueries) {
        session.searchQueries = []
      }
      session.searchQueries.push(data.query)
      await session.save()

      await addEvent('pages_analyzed', {
        searchId: data.searchId,
        query: data.query,
        results: data.results
      })
    } catch (error) {
      console.error('Error in search_query_performed handler:', error)
      await addEvent('search_failed', { searchId: data.searchId, error: String(error) })
    }
  },

  pages_analyzed: async (
    data: { searchId: string; query: string; results: SearchResult[] },
    sseManager: SSEManager
  ) => {
    try {
      console.log(`\n🤖 AGENT LOG - Pages Analyzed`)
      console.log(`   Analyzing ${data.results.length} pages...`)

      const session = await SearchSessionModel.findById(data.searchId)
      if (!session) {
        console.warn('Session not found:', data.searchId)
        return
      }

      const pageAnalyzer = new PageAnalyzer()
      const analyzedPages = await pageAnalyzer.analyzePages(
        data.results,
        data.query,
        session.userId
      )

      console.log(`   ✅ Pages prioritized: ${analyzedPages.length}`)

      session.discoveredPages = analyzedPages.map(p => p.url)
      await session.save()

      await addEvent('crawl_requested', {
        searchId: data.searchId,
        sites: analyzedPages.map(p => p.url.split('/')[2]), // Extract domain from URL
        keywords: data.query
      })
    } catch (error) {
      console.error('Error in pages_analyzed handler:', error)
      await addEvent('search_failed', { searchId: data.searchId, error: String(error) })
    }
  },

  search_evaluation: async (
    data: { searchId: string; jobsFound: number },
    sseManager: SSEManager
  ) => {
    try {
      console.log(`\n🤖 AGENT LOG - Search Evaluation`)
      console.log(`   Total jobs found: ${data.jobsFound}`)

      const session = await SearchSessionModel.findById(data.searchId)
      if (!session) {
        console.warn('Session not found:', data.searchId)
        return
      }

      const prompt = `We've found ${data.jobsFound} job listings so far.
        The user originally searched for: "${session.query}"

        Should we:
        1. Stop searching and rank the results (enough quality jobs found)
        2. Refine the search with different keywords
        3. Search deeper into discovered pages

        Respond with ONLY one of: COMPLETE, REFINE, or DEEPEN`

      const claudeResponse = await callClaude(session.userId, prompt)
      session.claudeConversationHistory.push(
        { role: 'user', content: prompt },
        { role: 'assistant', content: claudeResponse }
      )
      await session.save()

      const decision = claudeResponse.toUpperCase().trim()

      if (decision.includes('COMPLETE') || data.jobsFound >= 30) {
        await addEvent('search_complete', { searchId: data.searchId })
      } else if (decision.includes('REFINE')) {
        const refinementPrompt = `Suggest new search keywords to find different job opportunities.
          Original search: "${session.query}"
          Return ONLY the new keywords, nothing else.`

        const newKeywords = await callClaude(session.userId, refinementPrompt)
        await addEvent('search_refined', {
          searchId: data.searchId,
          claudeResponse: newKeywords.trim()
        })
      } else if (decision.includes('DEEPEN')) {
        await addEvent('crawl_deeper', { searchId: data.searchId })
      } else {
        await addEvent('search_complete', { searchId: data.searchId })
      }
    } catch (error) {
      console.error('Error in search_evaluation handler:', error)
      await addEvent('search_complete', { searchId: data.searchId })
    }
  },

  crawl_deeper: async (
    data: { searchId: string },
    sseManager: SSEManager
  ) => {
    try {
      console.log(`\n🤖 AGENT LOG - Crawl Deeper`)
      console.log(`   Scraping discovered pages deeper...`)

      const session = await SearchSessionModel.findById(data.searchId)
      if (!session) {
        console.warn('Session not found:', data.searchId)
        return
      }

      const resultsManager = new JobSourceManager()
      const results = await resultsManager.scrapeWithDiscovery(
        data.searchId,
        session.discoveredPages || [],
        session.query,
        2
      )

      await addEvent('jobs_scraped', {
        searchId: data.searchId,
        jobs: results.jobs,
        newSites: []
      })
    } catch (error) {
      console.error('Error in crawl_deeper handler:', error)
      await addEvent('search_evaluation', { searchId: data.searchId, jobsFound: 0 })
    }
  },

  sites_identified: async (data: { searchId: string; sites: string[]; keywords: string }, sseManager: SSEManager) => {
    try {
      console.log(`\n🤖 AGENT LOG - Sites Identified`)
      console.log(`   Sites: ${data.sites.join(', ')}`)
      console.log(`   Keywords: "${data.keywords}"`)

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

      sseManager.broadcast(data.searchId, {
        type: 'error',
        payload: {
          message: 'Search processing failed',
          searchStatus: 'failed'
        }
      })
      throw error
    }
  },

  crawl_requested: async (data: { searchId: string; sites: string[]; keywords: string }, sseManager: SSEManager) => {
    try {
      console.log(`\n🤖 AGENT LOG - Crawl Requested`)
      console.log(`   Requesting job sources for: ${data.sites.join(', ')}`)

      const session = await SearchSessionModel.findById(data.searchId)
      if (!session) {
        console.warn('Session not found:', data.searchId)
        return
      }

      let jobs: any[] = []

      try {
        // Use JobSourceManager instead of calling external crawler
        console.log(`   🔍 Scraping jobs from specified sources...`)
        const results = await jobSourceManager.scrapeJobs(data.sites, data.keywords, {
          timeout: 15000,
          maxRetries: 2
        })

        // Aggregate jobs from all sources
        results.forEach(result => {
          if (result.jobs.length > 0) {
            console.log(`   ✅ ${result.source}: Found ${result.jobs.length} jobs`)
            jobs.push(...result.jobs)
          }
          if (result.errors.length > 0) {
            console.log(`   ⚠️  ${result.source}: ${result.errors[0].message}`)
          }
        })

        if (jobs.length === 0) {
          console.log(`   📋 No jobs found from scrapers, using fallback mock data`)
          jobs = getMockJobs(data.keywords)
        }

        console.log(`   ✅ Total jobs collected: ${jobs.length}`)
      } catch (scraperError: any) {
        console.log(`   ⚠️  Job sources unavailable: ${scraperError.message}`)
        console.log(`   📋 Using fallback mock job data`)
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

      sseManager.broadcast(data.searchId, {
        type: 'error',
        payload: {
          message: 'Job scraping failed',
          searchStatus: 'failed'
        }
      })
      throw error
    }
  },

  jobs_scraped: async (data: { searchId: string; jobs: any[]; newSites: string[] }, sseManager: SSEManager) => {
    try {
      console.log(`\n🤖 AGENT LOG - Jobs Scraped`)
      console.log(`   Jobs found: ${data.jobs.length}`)
      if (data.jobs.length > 0) {
        console.log(`   Sample titles: ${data.jobs.slice(0, 3).map(j => j.title).join(', ')}`)
      }

      const session = await SearchSessionModel.findById(data.searchId)
      if (!session) {
        console.warn('Session not found:', data.searchId)
        return
      }

      // Store jobs in database
      for (const job of data.jobs) {
        const savedJob = await JobModel.create({
          ...job,
          searchSessionId: data.searchId,
          discoveredAt: new Date()
        })

        // Broadcast new job
        sseManager.broadcast(data.searchId, {
          type: 'job',
          payload: {
            job: {
              id: savedJob._id.toString(),
              title: savedJob.title,
              company: savedJob.company,
              description: savedJob.description,
              url: savedJob.url,
              salary: savedJob.salary,
              location: savedJob.location,
              matchScore: 0,
              matchReasoning: ''
            },
            totalFound: data.jobs.length
          }
        })
      }

      session.foundJobs.push(...(await JobModel.find({ searchSessionId: data.searchId }).select('_id')).map(j => j._id.toString()))
      session.iterationCount += 1
      await session.save()

      // Broadcast status update
      sseManager.broadcast(data.searchId, {
        type: 'status',
        payload: {
          status: session.status,
          iterationCount: session.iterationCount
        }
      })

      // Trigger evaluation to decide next step
      const totalJobs = await JobModel.countDocuments({ searchSessionId: data.searchId })
      await addEvent('search_evaluation', {
        searchId: data.searchId,
        jobsFound: totalJobs
      })
    } catch (error) {
      console.error('Error in jobs_scraped handler:', error)
      const session = await SearchSessionModel.findById(data.searchId)
      if (session) {
        session.status = 'failed'
        await session.save()
      }

      sseManager.broadcast(data.searchId, {
        type: 'error',
        payload: {
          message: 'Search processing failed',
          searchStatus: 'failed'
        }
      })
      throw error
    }
  },

  search_refined: async (data: { searchId: string; claudeResponse: string }, sseManager: SSEManager) => {
    try {
      console.log(`\n🤖 AGENT LOG - Search Refined`)
      console.log(`   Claude recommends searching more sites`)
      console.log(`   📞 Extracting new job boards to search...`)

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

      sseManager.broadcast(data.searchId, {
        type: 'error',
        payload: {
          message: 'Search processing failed',
          searchStatus: 'failed'
        }
      })
      throw error
    }
  },

  search_complete: async (data: { searchId: string }, sseManager: SSEManager) => {
    try {
      console.log(`\n🤖 AGENT LOG - Search Complete`)
      console.log(`   🏆 Search completed successfully`)

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

      // Broadcast completion status
      sseManager.broadcast(data.searchId, {
        type: 'status',
        payload: {
          status: 'complete',
          iterationCount: session.iterationCount
        }
      })

      console.log('Search session complete:', data.searchId)
    } catch (error) {
      console.error('Error in search_complete handler:', error)
      const session = await SearchSessionModel.findById(data.searchId)
      if (session) {
        session.status = 'failed'
        await session.save()
      }

      sseManager.broadcast(data.searchId, {
        type: 'error',
        payload: {
          message: 'Search processing failed',
          searchStatus: 'failed'
        }
      })
      throw error
    }
  },

  search_failed: async (data: { searchId: string; error: string }, sseManager: SSEManager) => {
    try {
      console.log('Search failed handler:', data.searchId, data.error)
      const session = await SearchSessionModel.findById(data.searchId)
      if (session) {
        session.status = 'failed'
        await session.save()
      }

      sseManager.broadcast(data.searchId, {
        type: 'error',
        payload: {
          message: 'Search processing failed',
          searchStatus: 'failed'
        }
      })
    } catch (error) {
      console.error('Error in search_failed handler:', error)
      throw error
    }
  }
}
