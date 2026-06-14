import axios from 'axios'
import { SearchSessionModel, JobModel, SiteModel, CompanyModel, UserModel } from '../db/models.js'
import { addEvent } from './queue.js'
import { callClaude } from '../claude/client.js'
import { SSEManager } from '../utils/SSEManager.js'
import { JobSourceManager } from '../job-sources/manager.js'
import { SearchService } from '../job-sources/search-service.js'
import { PageAnalyzer } from '../job-sources/page-analyzer.js'
import { SearchResult, AnalyzedPage } from '../job-sources/interfaces.js'
import { validateAndExtractCompanies } from '../utils/company-discovery.js'
import { calculateKeywordMatch, passesKeywordThreshold } from '../utils/job-matcher.js'
import { SearchSourceManager } from '../search-sources/searxng-source.js'

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

      // Get user's Claude API token
      const user = await UserModel.findById(data.userId)
      if (!user || !user.claudeApiToken) {
        console.error('User or Claude API token not found')
        await addEvent('search_failed', {
          searchId: data.searchId,
          error: 'Claude API token not configured'
        })
        return
      }

      // Use SearchSourceManager to discover companies via SearXNG
      console.log(`   🔍 Discovering companies via SearchSourceManager...`)
      const searchSourceManager = new SearchSourceManager(user.claudeApiToken)
      const companies = await searchSourceManager.discoverCompanies(data.searchId, data.query)

      console.log(`   ✅ Found ${companies.length} companies`)

      if (companies.length === 0) {
        console.log(`   📋 No companies discovered, search failed`)
        await addEvent('search_failed', {
          searchId: data.searchId,
          error: 'No company career pages found'
        })
        return
      }

      // Emit companies_discovered event to proceed with storing
      await addEvent('companies_discovered', {
        searchId: data.searchId,
        companies: companies.map(c => ({
          url: c.url,
          name: c.name,
          discoveredFrom: 'searxng',
          confidence: c.confidence
        })),
        userQuery: data.query
      })
    } catch (error) {
      console.error('Error in search_started handler:', error)
      await addEvent('search_failed', {
        searchId: data.searchId,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  },

  companies_discovered: async (
    data: { searchId: string; companies: Array<{ url: string; name: string; discoveredFrom: string; confidence: 'high' | 'medium' | 'low' }>; userQuery: string },
    sseManager: SSEManager
  ) => {
    try {
      console.log(`\n🤖 AGENT LOG - Companies Discovered`)
      console.log(`   Storing ${data.companies.length} discovered companies...`)

      const session = await SearchSessionModel.findById(data.searchId)
      if (!session) {
        console.warn('Session not found:', data.searchId)
        return
      }

      // Store each company in MongoDB (upsert by URL to handle re-discovered companies)
      const createdCompanies = []
      for (const company of data.companies) {
        const doc = await CompanyModel.findOneAndUpdate(
          { url: company.url },
          {
            $set: {
              name: company.name,
              discoveredFrom: company.discoveredFrom,
              searchQuery: data.userQuery,
              confidence: company.confidence,
              status: 'pending_crawl',
              crawlAttempts: 0
            }
          },
          { upsert: true, new: true }
        )
        createdCompanies.push(doc)
      }

      console.log(`   📝 Created ${createdCompanies.length} company records`)

      // Update SearchSession with discovery stats
      session.companiesDiscovered = data.companies.length
      session.companiesRemaining = data.companies.length
      await session.save()

      console.log(`   ✅ SearchSession updated with discovery stats`)

      // Queue first batch for crawling (10 companies max)
      const batchSize = Math.min(10, createdCompanies.length)
      const firstBatch = createdCompanies.slice(0, batchSize)

      console.log(`   ✅ Queuing first batch of ${batchSize} companies for crawl`)

      await addEvent('companies_queued_for_crawl', {
        searchId: data.searchId,
        companyIds: firstBatch.map(c => c._id.toString())
      })
    } catch (error) {
      console.error('Error in companies_discovered handler:', error)
      await addEvent('search_failed', {
        searchId: data.searchId,
        error: error instanceof Error ? error.message : 'Failed to process discovered companies'
      })
    }
  },

  careers_pages_found: async (
    data: { searchId: string; query: string; searchResults: SearchResult[] },
    sseManager: SSEManager
  ) => {
    try {
      console.log(`\n🤖 AGENT LOG - Careers Pages Found`)
      console.log(`   Found ${data.searchResults.length} career pages`)

      const session = await SearchSessionModel.findById(data.searchId)
      if (!session) {
        console.warn('Session not found:', data.searchId)
        return
      }

      // Use Claude to extract and validate companies
      const companies = await validateAndExtractCompanies(
        session.userId,
        data.query,
        data.searchResults
      )

      console.log(`   ✅ Identified ${companies.length} companies`)

      if (companies.length === 0) {
        await addEvent('search_failed', {
          searchId: data.searchId,
          error: 'No companies identified from search results'
        })
        return
      }

      await addEvent('companies_identified', {
        searchId: data.searchId,
        query: data.query,
        companies
      })
    } catch (error) {
      console.error('Error in careers_pages_found handler:', error)
      await addEvent('search_failed', { searchId: data.searchId, error: String(error) })
    }
  },

  companies_identified: async (
    data: { searchId: string; query: string; companies: any[] },
    sseManager: SSEManager
  ) => {
    try {
      console.log(`\n🤖 AGENT LOG - Companies Identified`)
      console.log(`   Creating company records for ${data.companies.length} companies...`)

      const session = await SearchSessionModel.findById(data.searchId)
      if (!session) {
        console.warn('Session not found:', data.searchId)
        return
      }

      // Create Company documents in database (upsert by URL to handle re-discovered companies)
      const createdCompanies = []
      for (const company of data.companies) {
        const doc = await CompanyModel.findOneAndUpdate(
          { url: company.url },
          {
            $set: {
              name: company.name,
              location: company.location,
              searchQuery: data.query,
              discoveredFrom: 'search_results',
              status: 'pending_crawl'
            }
          },
          { upsert: true, new: true }
        )
        createdCompanies.push(doc)
      }

      console.log(`   📝 Created ${createdCompanies.length} company records`)

      // Update session tracking
      session.companiesDiscovered = data.companies.length
      session.companiesRemaining = data.companies.length
      await session.save()

      // Select first batch: min(10, total) companies
      const batchSize = Math.min(10, createdCompanies.length)
      const firstBatch = createdCompanies.slice(0, batchSize)

      console.log(`   ✅ Queuing first batch of ${batchSize} companies for crawl`)

      await addEvent('companies_queued_for_crawl', {
        searchId: data.searchId,
        companyIds: firstBatch.map(c => c._id.toString())
      })
    } catch (error) {
      console.error('Error in companies_identified handler:', error)
      await addEvent('search_failed', { searchId: data.searchId, error: String(error) })
    }
  },

  companies_queued_for_crawl: async (
    data: { searchId: string; companyIds: string[] },
    sseManager: SSEManager
  ) => {
    try {
      console.log(`\n🤖 AGENT LOG - Companies Queued For Crawl`)
      console.log(`   Processing ${data.companyIds.length} companies...`)

      const session = await SearchSessionModel.findById(data.searchId)
      if (!session) {
        console.warn('Session not found:', data.searchId)
        return
      }

      // Update each company status to crawling and emit crawl events
      for (const companyId of data.companyIds) {
        const company = await CompanyModel.findById(companyId)
        if (!company) {
          console.warn(`Company not found: ${companyId}`)
          continue
        }

        // Update status to crawling
        company.status = 'crawling'
        await company.save()

        // Emit crawl event for this company
        await addEvent('crawl_company', {
          searchId: data.searchId,
          companyId: company._id.toString(),
          url: company.url,
          companyName: company.name,
          query: session.query
        })
      }

      console.log(`   ✅ Crawl events emitted`)
    } catch (error) {
      console.error('Error in companies_queued_for_crawl handler:', error)
      await addEvent('search_failed', { searchId: data.searchId, error: String(error) })
    }
  },

  crawl_company: async (
    data: { searchId: string; companyId: string; url: string; companyName: string; query: string },
    sseManager: SSEManager
  ) => {
    try {
      console.log(`\n🤖 AGENT LOG - Crawl Company`)
      console.log(`   Crawling ${data.companyName} at ${data.url}`)

      const crawlerUrl = process.env.CRAWLER_SERVICE_URL || 'http://localhost:5000'
      const response = await axios.post(`${crawlerUrl}/crawler/crawl-company`, {
        searchId: data.searchId,
        companyId: data.companyId,
        url: data.url,
        companyName: data.companyName,
        query: data.query
      }, { timeout: 60000 })

      const result = response.data
      console.log(`   ✅ Crawled ${data.companyName}: ${result.jobs?.length || 0} jobs found`)

      await addEvent('company_crawled', {
        searchId: data.searchId,
        companyId: data.companyId,
        jobs: result.jobs || [],
        discoveredCompanies: result.discoveredCompanies || []
      })
    } catch (error: any) {
      console.error(`Error crawling company ${data.companyName}:`, error.message)
      const company = await CompanyModel.findById(data.companyId)
      if (company) {
        company.status = 'failed'
        await company.save()
      }
    }
  },

  company_crawled: async (
    data: { searchId: string; companyId: string; jobs: any[]; discoveredCompanies: any[] },
    sseManager: SSEManager
  ) => {
    try {
      console.log(`\n🤖 AGENT LOG - Company Crawled`)
      console.log(`   Processing ${data.jobs.length} jobs and ${data.discoveredCompanies.length} discovered companies`)

      const session = await SearchSessionModel.findById(data.searchId)
      if (!session) {
        console.warn('Session not found:', data.searchId)
        return
      }

      // Update company status to crawled
      const company = await CompanyModel.findById(data.companyId)
      if (company) {
        company.status = 'crawled'
        company.lastCrawlTime = new Date()
        await company.save()
      }

      // Store jobs that pass keyword threshold
      let jobsStored = 0
      for (const job of data.jobs) {
        const keywordMatch = calculateKeywordMatch(
          job.title,
          session.query,
          job.description
        )

        // Only store if passes threshold (0.4)
        if (passesKeywordThreshold(keywordMatch.score, 0.4)) {
          const savedJob = await JobModel.create({
            ...job,
            searchSessionId: session._id.toString(),
            companyId: data.companyId,
            discoveryMethod: 'company_page',
            keywordMatchScore: keywordMatch.score,
            keywordMatchReasoning: keywordMatch.reasoning,
            extractedAt: new Date(),
            discoveredAt: new Date()
          })
          jobsStored++
        }
      }

      console.log(`   ✅ Stored ${jobsStored} jobs (passed keyword threshold)`)

      // Validate and discover new companies
      let companiesDiscovered = 0
      if (data.discoveredCompanies.length > 0) {
        const validated = await validateAndExtractCompanies(
          session.userId,
          session.query,
          data.discoveredCompanies
        )

        for (const discoveredCompany of validated) {
          // Check if company already exists
          const existing = await CompanyModel.findOne({ url: discoveredCompany.url })
          if (!existing) {
            await CompanyModel.create({
              name: discoveredCompany.name,
              url: discoveredCompany.url,
              location: discoveredCompany.location,
              searchQuery: session.query,
              discoveredFrom: company?.url || 'unknown',
              status: 'pending_crawl'
            })
            companiesDiscovered++
          }
        }
      }

      console.log(`   🏢 Discovered ${companiesDiscovered} new companies`)

      // Update session stats
      session.companiesCrawled += 1
      session.jobsExtracted += jobsStored
      session.companiesRemaining -= 1
      await session.save()

      // Check if need to expand search (jobs < 20 and companies remaining > 0)
      if (session.jobsExtracted < 20 && session.companiesRemaining > 0) {
        console.log(`   📊 Need more jobs (${session.jobsExtracted} < 20), queuing next batch...`)
        session.expandedSearch = true
        await session.save()

        // Get next batch of pending companies
        const nextBatch = await CompanyModel.find({
          searchQuery: session.query,
          status: 'pending_crawl',
          _id: { $ne: data.companyId }
        }).limit(Math.min(10, session.companiesRemaining))

        if (nextBatch.length > 0) {
          await addEvent('companies_queued_for_crawl', {
            searchId: data.searchId,
            companyIds: nextBatch.map(c => c._id.toString())
          })
        }
      }

      // Emit jobs_extracted if any jobs were stored
      if (jobsStored > 0) {
        const storedJobs = await JobModel.find({
          searchSessionId: session._id,
          companyId: data.companyId
        })
        await addEvent('jobs_extracted', {
          searchId: data.searchId,
          jobIds: storedJobs.map(j => j._id.toString())
        })
      }
    } catch (error) {
      console.error('Error in company_crawled handler:', error)
      await addEvent('search_failed', { searchId: data.searchId, error: String(error) })
    }
  },

  jobs_extracted: async (
    data: { searchId: string; jobIds: string[] },
    sseManager: SSEManager
  ) => {
    try {
      console.log(`\n🤖 AGENT LOG - Jobs Extracted`)
      console.log(`   Scoring ${data.jobIds.length} jobs...`)

      const session = await SearchSessionModel.findById(data.searchId)
      if (!session) {
        console.warn('Session not found:', data.searchId)
        return
      }

      // Fetch jobs from database
      const jobs = await JobModel.find({ _id: { $in: data.jobIds } })

      // Build prompt for Claude to score jobs
      const jobDetails = jobs
        .map(j => `JobID: ${j._id}\nTitle: ${j.title}\nCompany: ${j.company}\nDescription: ${j.description}\nLocation: ${j.location}`)
        .join('\n---\n')

      const prompt = `Score these jobs by how well they match the search query: "${session.query}".
For each job, provide:
1. jobId (exact match from the list)
2. matchScore (0-100)
3. reasoning (brief explanation)

Return JSON with structure: { "scores": [{ "jobId": "...", "matchScore": 0, "reasoning": "..." }] }

Jobs to score:
${jobDetails}`

      let scores: any[] = []
      try {
        const response = await callClaude(session.userId, prompt)
        const parsed = JSON.parse(response)
        scores = parsed.scores || []
      } catch (error) {
        console.warn('Claude scoring failed, assigning default scores:', error)
        // Assign default score on error
        scores = jobs.map(j => ({
          jobId: j._id.toString(),
          matchScore: 50,
          reasoning: 'Default score due to scoring error'
        }))
      }

      // Update each job with score
      for (const scoreData of scores) {
        const jobId = scoreData.jobId
        await JobModel.findByIdAndUpdate(jobId, {
          matchScore: scoreData.matchScore,
          matchReasoning: scoreData.reasoning,
          scoredAt: new Date(),
          scoredVersion: 1
        })
      }

      session.jobsScored += data.jobIds.length
      await session.save()

      console.log(`   ✅ Scored ${data.jobIds.length} jobs`)

      // Emit results ready
      await addEvent('results_ready_for_frontend', {
        searchId: data.searchId,
        scoredJobIds: data.jobIds
      })
    } catch (error) {
      console.error('Error in jobs_extracted handler:', error)
      await addEvent('search_failed', { searchId: data.searchId, error: String(error) })
    }
  },

  results_ready_for_frontend: async (
    data: { searchId: string; scoredJobIds: string[] },
    sseManager: SSEManager
  ) => {
    try {
      console.log(`\n🤖 AGENT LOG - Results Ready For Frontend`)
      console.log(`   Broadcasting ${data.scoredJobIds.length} scored jobs`)

      // Broadcast via SSE
      sseManager.broadcast(data.searchId, {
        type: 'results_updated',
        payload: {
          scoredJobIds: data.scoredJobIds,
          totalScored: data.scoredJobIds.length
        }
      })

      console.log(`   ✅ Results broadcast complete`)
    } catch (error) {
      console.error('Error in results_ready_for_frontend handler:', error)
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
        sites: analyzedPages.map(p => p.url), // Pass full URLs, not just domains
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
      console.error('❌ Job scraping failed:', error)
      await addEvent('search_failed', {
        searchId: data.searchId,
        error: `Crawler error: ${String(error)}`
      })
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

      // Use JobSourceManager instead of calling external crawler
      console.log(`   🔍 Scraping jobs from specified sources...`)
      const results = await jobSourceManager.scrapeJobs(data.sites, data.keywords, {
        timeout: 15000,
        maxRetries: 2
      })

      // Aggregate jobs from all sources
      let jobs: any[] = []
      results.forEach(result => {
        if (result.jobs.length > 0) {
          console.log(`   ✅ ${result.source}: Found ${result.jobs.length} jobs`)
          jobs.push(...result.jobs)
        }
        if (result.errors.length > 0) {
          console.log(`   ⚠️  ${result.source}: ${result.errors[0].message}`)
        }
      })

      console.log(`   ✅ Total jobs collected: ${jobs.length}`)

      await addEvent('jobs_scraped', {
        searchId: data.searchId,
        jobs,
        newSites: []
      })
    } catch (error) {
      console.error('❌ Job scraping failed:', error)
      await addEvent('search_failed', { searchId: data.searchId, error: `Crawler error: ${String(error)}` })

      sseManager.broadcast(data.searchId, {
        type: 'error',
        payload: {
          message: 'Job scraping failed',
          searchStatus: 'failed'
        }
      })
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
