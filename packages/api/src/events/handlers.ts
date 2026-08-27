import axios from 'axios'
import { SearchSessionModel, JobModel, SiteModel, CompanyModel } from '../db/models.js'
import { addEvent } from './queue.js'
import { callLLM, callLLMJson } from '../ai/llm.js'
import { SSEManager } from '../utils/SSEManager.js'
import { JobSourceManager } from '../job-sources/manager.js'
import { SearchService } from '../job-sources/search-service.js'
import { PageAnalyzer } from '../job-sources/page-analyzer.js'
import { SearchResult, AnalyzedPage } from '../job-sources/interfaces.js'
import { validateAndExtractCompanies } from '../utils/company-discovery.js'
import { calculateKeywordMatch, passesKeywordThreshold, KeywordMatchResult } from '../utils/job-matcher.js'
import { SearchSourceManager } from '../search-sources/searxng-source.js'
import { SourceManager } from '../sources/manager.js'
import { ArbeitsagenturSource } from '../sources/arbeitsagentur-source.js'
import { emitPipelineEvent } from '../utils/pipeline.js'

const jobSourceManager = new JobSourceManager()

/**
 * True when a session is still in the runnable `running` state. Handlers use
 * this to bail out early when a search was already marked complete/failed
 * (e.g. by the sweeper or a previous queue retry) so work isn't redone.
 */
function isSessionActive(session: any): boolean {
  return !!session && session.status === 'running'
}

function broadcastSessionStatus(session: any, sseManager: SSEManager): void {
  if (!sseManager) return
  sseManager.broadcast(session._id.toString(), {
    type: 'status',
    payload: {
      status: session.status,
      iterationCount: session.iterationCount,
      companiesDiscovered: session.companiesDiscovered,
      companiesCrawled: session.companiesCrawled,
      companiesRemaining: session.companiesRemaining,
      jobsExtracted: session.jobsExtracted,
      jobsFilteredOut: session.jobsFilteredOut,
      jobsScored: session.jobsScored,
      expandedSearch: session.expandedSearch,
    },
  })
}

export const eventHandlers = {
  search_started: async (data: { searchId: string; userId: string; query: string }, sseManager: SSEManager) => {
    try {
      console.log(`\n🤖 AGENT LOG - Search Started`)
      console.log(`   Query: "${data.query}"`)

      await emitPipelineEvent(data.searchId, 'search_started', 'info', 'Search started', `Query: "${data.query}"`, { query: data.query }, sseManager)

      const session = await SearchSessionModel.findById(data.searchId)
      if (!session) {
        console.warn('Session not found:', data.searchId)
        return
      }

      if (!isSessionActive(session)) {
        console.warn(`Search ${data.searchId} is not active (${session.status}), skipping discovery`)
        return
      }

      // Tier-1 sources: query-native job APIs. Additive — runs alongside the existing
      // company-discovery path. Stores jobs and joins the existing scoring pipeline.
      await emitPipelineEvent(data.searchId, 'tier1_search', 'info', 'Querying Arbeitsagentur API', `Keywords: "${data.query}"`, { keywords: data.query }, sseManager)
      const sourceManager = new SourceManager([new ArbeitsagenturSource()])
      const sourceResult = await sourceManager.search({ keywords: data.query, raw: data.query })
      if (sourceResult.errors.length > 0) {
        console.warn(`   ⚠️  Source errors: ${sourceResult.errors.map(e => e.message).join('; ')}`)
      }

      let apiJobsStored = 0
      const storedApiJobIds: string[] = []
      for (const job of sourceResult.jobs) {
        const exists = await JobModel.findOne({ searchSessionId: data.searchId, url: job.url })
        if (exists) continue
        const saved = await JobModel.create({
          ...job,
          searchSessionId: data.searchId,
          discoveryMethod: 'arbeitsagentur',
          discoveredAt: new Date(),
          extractedAt: new Date(),
        })
        storedApiJobIds.push(saved._id.toString())
        apiJobsStored++
      }

      if (apiJobsStored > 0) {
        session.jobsExtracted += apiJobsStored
        await session.save()
        broadcastSessionStatus(session, sseManager)
        await emitPipelineEvent(data.searchId, 'tier1_results', 'result', `Arbeitsagentur: ${apiJobsStored} jobs stored`, undefined, { count: apiJobsStored }, sseManager)
        await addEvent('jobs_extracted', {
          searchId: data.searchId,
          jobIds: storedApiJobIds,
        })
      }
      console.log(`   ✅ Tier-1 sources stored ${apiJobsStored} jobs`)

      // Use SearchSourceManager to discover companies via SearXNG + opencode
      console.log(`   🔍 Discovering hidden-gem companies via SearchSourceManager...`)
      await emitPipelineEvent(data.searchId, 'tier2_discovery', 'info', 'Starting SearXNG company discovery', 'AI-driven multi-round search', undefined, sseManager)
      const searchSourceManager = new SearchSourceManager()
      const companies = await searchSourceManager.discoverCompanies(data.searchId, data.query, sseManager)

      console.log(`   ✅ Found ${companies.length} companies`)

      if (companies.length === 0) {
        if (apiJobsStored > 0) {
          console.log(`   📋 No companies discovered, but ${apiJobsStored} API jobs found — completing search`)
          await addEvent('search_complete', { searchId: data.searchId })
          return
        }
        console.log(`   📋 No companies discovered and no API jobs, search failed`)
        await addEvent('search_failed', {
          searchId: data.searchId,
          error: 'No jobs found'
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
          confidence: c.confidence,
          hiddenGemScore: c.hiddenGemScore,
          sizeBand: c.sizeBand,
          sizeSignals: c.sizeSignals
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
    data: {
      searchId: string
      companies: Array<{
        url: string
        name: string
        discoveredFrom: string
        confidence: 'high' | 'medium' | 'low'
        hiddenGemScore?: number
        sizeBand?: 'small' | 'medium' | 'large' | 'unknown'
        sizeSignals?: string[]
      }>
      userQuery: string
    },
    sseManager: SSEManager
  ) => {
    try {
      console.log(`\n🤖 AGENT LOG - Companies Discovered`)
      console.log(`   Storing ${data.companies.length} discovered companies...`)

      await emitPipelineEvent(data.searchId, 'companies_stored', 'result', `${data.companies.length} companies discovered`, data.companies.map(c => c.name).join(', '), { companies: data.companies.map(c => ({ name: c.name, url: c.url, confidence: c.confidence })) }, sseManager)

      const session = await SearchSessionModel.findById(data.searchId)
      if (!session) {
        console.warn('Session not found:', data.searchId)
        return
      }

      if (!isSessionActive(session)) {
        console.warn(`Search ${data.searchId} is not active (${session.status}), skipping company storage`)
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
              searchSessionId: data.searchId,
              confidence: company.confidence,
              hiddenGemScore: company.hiddenGemScore,
              sizeBand: company.sizeBand,
              sizeSignals: company.sizeSignals,
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
      broadcastSessionStatus(session, sseManager)

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

      // Use opencode to extract and validate companies
      const companies = await validateAndExtractCompanies(
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

      if (!isSessionActive(session)) {
        console.warn(`Search ${data.searchId} is not active (${session.status}), skipping company storage`)
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
              searchSessionId: data.searchId,
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
      broadcastSessionStatus(session, sseManager)

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

      if (!isSessionActive(session)) {
        console.warn(`Search ${data.searchId} is not active (${session.status}), skipping crawl batch`)
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
      await emitPipelineEvent(data.searchId, 'crawl', 'info', `Crawling: ${company.name}`, company.url, { companyId, url: company.url }, sseManager)
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

      await emitPipelineEvent(data.searchId, 'crawl_company', 'info', `Crawling ${data.companyName}`, data.url, { url: data.url, companyName: data.companyName }, sseManager)

      const session = await SearchSessionModel.findById(data.searchId)
      if (!session) {
        console.warn('Session not found:', data.searchId)
        return
      }

      const crawlerUrl = process.env.CRAWLER_SERVICE_URL || 'http://localhost:5000'
      const response = await axios.post(
        `${crawlerUrl}/crawler/crawl-company`,
        {
          searchId: data.searchId,
          companyId: data.companyId,
          url: data.url,
          companyName: data.companyName,
          query: data.query,
        },
        { timeout: 90000 }
      )

      const result = response.data
      console.log(`   ✅ Crawled ${data.companyName}: ${result.jobs?.length || 0} jobs found`)

      await emitPipelineEvent(data.searchId, 'crawl_result', 'result', `${data.companyName}: ${(result.jobs?.length || 0)} jobs found`, undefined, { companyName: data.companyName, jobCount: result.jobs?.length || 0 }, sseManager)
      await addEvent('company_crawled', {
        searchId: data.searchId,
        companyId: data.companyId,
        jobs: result.jobs || [],
        discoveredCompanies: result.discoveredCompanies || [],
        unsupported: result.unsupported || false,
      })
    } catch (error: any) {
      console.error(`Error crawling company ${data.companyName}:`, error.message)
      const company = await CompanyModel.findById(data.companyId)
      if (company) {
        company.status = 'failed'
        await company.save()
      }
      await emitPipelineEvent(data.searchId, 'crawl_failed', 'error', `Failed to crawl ${data.companyName}: ${error.message}`, undefined, { companyName: data.companyName, error: error.message }, sseManager)
    }
  },

  company_crawled: async (
    data: { searchId: string; companyId: string; jobs: any[]; discoveredCompanies: any[]; unsupported?: boolean },
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

      if (!isSessionActive(session)) {
        console.warn(`Search ${data.searchId} is not active (${session.status}), skipping job storage`)
        return
      }

      // Update company status: unsupported if the crawl found nothing extractable, crawled otherwise
      const company = await CompanyModel.findById(data.companyId)
      if (company) {
        company.status = data.unsupported ? 'unsupported' : 'crawled'
        company.lastCrawlTime = new Date()
        await company.save()
      }

      // Store jobs that pass keyword threshold. Each job is handled in isolation —
      // a single malformed entry must not fail the whole search (A3).
      const evaluated: Array<{ job: any; keywordMatch: KeywordMatchResult; invalid?: boolean }> = []
      for (const job of data.jobs) {
        try {
          evaluated.push({
            job,
            keywordMatch: calculateKeywordMatch(job.title, session.query, job.description),
          })
        } catch (jobError) {
          console.warn(`Skipping job with unparseable title from ${company?.name || data.companyId}:`, jobError)
          evaluated.push({ job, keywordMatch: { score: 0, reasoning: 'Unparseable job entry' }, invalid: true })
        }
      }

      const passing = evaluated.filter(c => !c.invalid && passesKeywordThreshold(c.keywordMatch.score, 0.4))

      // Keyword filtering on mixed DE/EN listings is inherently lossy (B1). When
      // nothing passes the filter, fall back to storing all crawled jobs so the
      // LLM scorer — not a naive substring check — is the real relevance judge.
      const fallbackUnfiltered = passing.length === 0 && evaluated.length > 0
      const selected = fallbackUnfiltered ? evaluated : passing
      // Number of jobs dropped by the keyword filter (0 in fallback mode since
      // everything is stored). Tracked separately so stats reflect reality (B2).
      const filterRejected = fallbackUnfiltered ? 0 : evaluated.length - passing.length

      let jobsStored = 0
      let jobsSkipped = 0 // invalid/duplicate jobs that could not be persisted
      for (const { job, keywordMatch } of selected) {
        try {
          // Dedup within the session by URL (there is no global unique index).
          // Only when a URL is present — a url-less job can never match another.
          if (job.url) {
            const exists = await JobModel.findOne({
              searchSessionId: session._id.toString(),
              url: job.url,
            })
            if (exists) {
              jobsSkipped++
              continue
            }
          }
          await JobModel.create({
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
        } catch (jobError) {
          console.warn(`Skipping invalid job from ${company?.name || data.companyId}:`, jobError)
          jobsSkipped++
        }
      }

      console.log(`   ✅ Stored ${jobsStored} jobs (${filterRejected} filtered out, ${jobsSkipped} skipped)`)

      await emitPipelineEvent(data.searchId, 'jobs_filtered', 'result', `Keyword filter: ${jobsStored}/${data.jobs.length} jobs stored${fallbackUnfiltered ? ' (fallback: unfiltered)' : ''}`, undefined, { stored: jobsStored, total: data.jobs.length, filteredOut: filterRejected + jobsSkipped, fallback: fallbackUnfiltered }, sseManager)

      // Validate and discover new companies
      let companiesDiscovered = 0
      if (data.discoveredCompanies.length > 0) {
        const validated = await validateAndExtractCompanies(
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
              searchSessionId: session._id.toString(),
              discoveredFrom: company?.url || 'unknown',
              status: 'pending_crawl'
            })
            companiesDiscovered++
          } else {
            // Link this session to the company if not already linked
            if (existing.searchSessionId !== session._id.toString()) {
              existing.searchSessionId = session._id.toString()
              await existing.save()
            }
          }
        }
      }

      console.log(`   🏢 Discovered ${companiesDiscovered} new companies`)

      // Update session stats: jobsExtracted counts jobs actually stored (B2).
      session.companiesCrawled += 1
      session.jobsExtracted += jobsStored
      session.jobsFilteredOut = (session.jobsFilteredOut || 0) + filterRejected + jobsSkipped
      session.companiesRemaining -= 1
      await session.save()
      broadcastSessionStatus(session, sseManager)

      // Check if need to expand search (stored jobs < 20 and companies remaining > 0)
      const storedJobsCount = await JobModel.countDocuments({
        searchSessionId: session._id
      })
      if (storedJobsCount < 20 && session.companiesRemaining > 0) {
        console.log(`   📊 Need more jobs (${storedJobsCount} < 20), queuing next batch...`)
        session.expandedSearch = true
        await session.save()
        broadcastSessionStatus(session, sseManager)

        // Get next batch of pending companies. Companies are session-scoped:
        // only queue those discovered by this session, or companies that haven't
        // been crawled by anyone in 7+ days (stale re-crawl).
        const staleThreshold = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
        const nextBatch = await CompanyModel.find({
          status: 'pending_crawl',
          _id: { $ne: data.companyId },
          $or: [
            { searchSessionId: session._id.toString() },
            { lastCrawlTime: { $exists: false } },
            { lastCrawlTime: { $lt: staleThreshold } },
          ]
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

      // Finalization: once every discovered company has been crawled there is
      // nothing left to do, so evaluate and finish the search. Without this, a
      // session crawls all companies but stays stuck in "running" forever — the
      // completion signal otherwise only existed on the legacy jobs_scraped path.
      const pendingCompanies = await CompanyModel.countDocuments({
        searchSessionId: session._id.toString(),
        status: 'pending_crawl'
      })
      if (isSessionActive(session) && pendingCompanies === 0) {
        const totalStored = await JobModel.countDocuments({ searchSessionId: session._id })
        await addEvent('search_evaluation', { searchId: data.searchId, jobsFound: totalStored })
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

      await emitPipelineEvent(data.searchId, 'scoring_start', 'info', `Scoring ${data.jobIds.length} jobs with AI`, undefined, { jobCount: data.jobIds.length }, sseManager)

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

      // Score jobs via opencode; a failure bubbles up to search_failed
      await emitPipelineEvent(data.searchId, 'scoring_prompt', 'prompt', 'LLM scoring prompt', prompt, { jobCount: data.jobIds.length }, sseManager)
      const parsed = await callLLMJson<{ scores: any[] }>(prompt)
      const scores = parsed.scores || []

      await emitPipelineEvent(data.searchId, 'scoring_result', 'response', `AI scored ${scores.length} jobs`, undefined, { scoredCount: scores.length }, sseManager)

      // Update each job with score, counting only scores that actually match a
      // submitted job so jobsScored reflects reality (B2).
      let scoredCount = 0
      const scoredJobIds: string[] = []
      for (const scoreData of scores) {
        const jobId = scoreData.jobId
        if (!data.jobIds.includes(jobId)) continue
        const updated = await JobModel.findByIdAndUpdate(jobId, {
          matchScore: scoreData.matchScore,
          matchReasoning: scoreData.reasoning,
          scoredAt: new Date(),
          scoredVersion: 1
        })
        if (updated) {
          scoredCount++
          scoredJobIds.push(jobId)
        }
      }

      session.jobsScored += scoredCount
      await session.save()
      broadcastSessionStatus(session, sseManager)

      console.log(`   ✅ Scored ${scoredCount} jobs`)

      // Emit results ready with the jobs that were actually scored
      if (scoredJobIds.length > 0) {
        await addEvent('results_ready_for_frontend', {
          searchId: data.searchId,
          scoredJobIds
        })
      }
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

      // Load the scored jobs so the client can render them directly from SSE
      const jobDocs = await JobModel.find({ _id: { $in: data.scoredJobIds } })
      const jobs = jobDocs.map(job => ({
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

      // Broadcast full job objects via SSE
      sseManager.broadcast(data.searchId, {
        type: 'results_updated',
        payload: {
          jobs,
          totalScored: jobs.length
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
        data.query
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

      await emitPipelineEvent(data.searchId, 'evaluation', 'info', `Evaluating search progress: ${data.jobsFound} jobs found`, undefined, { jobsFound: data.jobsFound }, sseManager)

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

      await emitPipelineEvent(data.searchId, 'evaluation_prompt', 'prompt', 'LLM evaluation prompt', prompt, { jobsFound: data.jobsFound }, sseManager)
      const opencodeResponse = await callLLM(prompt)
      session.conversationHistory.push(
        { role: 'user', content: prompt },
        { role: 'assistant', content: opencodeResponse }
      )
      await session.save()

      const decision = opencodeResponse.toUpperCase().trim()

      await emitPipelineEvent(data.searchId, 'evaluation_response', 'response', `AI decision: ${decision}`, opencodeResponse, { decision }, sseManager)

      if (decision.includes('COMPLETE') || data.jobsFound >= 30) {
        await addEvent('search_complete', { searchId: data.searchId })
      } else if (decision.includes('REFINE')) {
        const refinementPrompt = `Suggest new search keywords to find different job opportunities.
          Original search: "${session.query}"
          Return ONLY the new keywords, nothing else.`

        const newKeywords = await callLLM(refinementPrompt)
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

      if (!isSessionActive(session)) {
        console.warn(`Search ${data.searchId} is not active (${session.status}), skipping site storage`)
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
        maxRetries: 2,
        searchId: data.searchId
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

      if (!isSessionActive(session)) {
        console.warn(`Search ${data.searchId} is not active (${session.status}), skipping scraped jobs`)
        return
      }

      // Store jobs in database (dedup by URL so queue retries don't duplicate)
      for (const job of data.jobs) {
        const exists = await JobModel.findOne({ searchSessionId: data.searchId, url: job.url })
        if (exists) continue
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
          iterationCount: session.iterationCount,
          companiesDiscovered: session.companiesDiscovered,
          companiesCrawled: session.companiesCrawled,
          companiesRemaining: session.companiesRemaining,
          jobsExtracted: session.jobsExtracted,
          jobsFilteredOut: session.jobsFilteredOut,
          jobsScored: session.jobsScored
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
      // Rethrow so the queue layer retries and marks the session failed after
      // retries are exhausted — no duplicate work on an already-failed session.
      throw error
    }
  },

  search_refined: async (data: { searchId: string; claudeResponse: string }, sseManager: SSEManager) => {
    try {
      console.log(`\n🤖 AGENT LOG - Search Refined`)
      console.log(`   Claude recommends searching more sites`)
      console.log(`   📞 Extracting new job boards to search...`)

      await emitPipelineEvent(data.searchId, 'search_refined', 'info', 'Search refined, extracting new sites', undefined, undefined, sseManager)

      const session = await SearchSessionModel.findById(data.searchId)
      if (!session) {
        console.warn('Session not found:', data.searchId)
        return
      }

      // Extract new sites from opencode response
      const prompt = `From your previous response, please extract the specific websites to search next in JSON format: {"sites": ["domain.com"]}`
      const parsed = await callLLMJson<{ sites: string[] }>(prompt)

      session.conversationHistory.push(
        { role: 'user', content: prompt },
        { role: 'assistant', content: JSON.stringify(parsed) }
      )
      await session.save()

      await addEvent('sites_identified', {
        searchId: data.searchId,
        sites: parsed.sites,
        keywords: session.query
      })
    } catch (error) {
      console.error('Error in search_refined handler:', error)
      throw error
    }
  },

  search_complete: async (data: { searchId: string }, sseManager: SSEManager) => {
    try {
      console.log(`\n🤖 AGENT LOG - Search Complete`)
      console.log(`   🏆 Search completed successfully`)

      await emitPipelineEvent(data.searchId, 'search_complete', 'info', 'Search completed, generating final ranking', undefined, undefined, sseManager)

      const session = await SearchSessionModel.findById(data.searchId)
      if (!session) {
        console.warn('Session not found:', data.searchId)
        return
      }

      if (!isSessionActive(session)) {
        console.warn(`Search ${data.searchId} is not active (${session.status}), skipping completion`)
        return
      }

      // Get all jobs for this search
      const jobs = await JobModel.find({ searchSessionId: data.searchId })

      // Ask opencode to rank and score jobs. The jobs are already extracted and
      // visible to the user, so a failure here must NOT leave the search stuck in
      // "running" — we always mark the session complete below, with best-effort scoring.
      let scores: Array<{ jobId: string; matchScore: number; reasoning: string }> = []
      try {
        const jobDetails = jobs
          .map(j => `JobID: ${j._id}\nTitle: ${j.title}\nCompany: ${j.company}\nLocation: ${j.location}`)
          .join('\n')
        const rankingPrompt = `Rank these jobs by how well they match "${session.query}".
For each job, provide a matchScore (0-100) and a brief reasoning.

Return JSON with structure: { "scores": [{ "jobId": "...", "matchScore": 0, "reasoning": "..." }] }

Jobs to rank:
${jobDetails}`

        await emitPipelineEvent(data.searchId, 'final_ranking_prompt', 'prompt', 'Final LLM ranking prompt', rankingPrompt, { jobCount: jobs.length }, sseManager)
        const parsed = await callLLMJson<{ scores: Array<{ jobId: string; matchScore: number; reasoning: string }> }>(rankingPrompt)
        scores = parsed.scores || []

        await emitPipelineEvent(data.searchId, 'final_ranking_response', 'response', `AI final ranking complete (${scores.length} jobs)`, JSON.stringify(scores), { scoredCount: scores.length }, sseManager)

        // Apply the final ranking to each job's matchScore (B3).
        for (const score of scores) {
          const jobId = score.jobId
          const currentJob = jobs.find(j => j._id.toString() === jobId)
          if (!currentJob) continue
          await JobModel.findByIdAndUpdate(jobId, {
            matchScore: score.matchScore,
            matchReasoning: score.reasoning,
            scoredAt: new Date(),
            scoredVersion: (currentJob.scoredVersion || 0) + 1
          })
        }

        session.conversationHistory.push(
          { role: 'user', content: rankingPrompt },
          { role: 'assistant', content: JSON.stringify(scores) }
        )
      } catch (rankingError) {
        console.error('Final ranking failed; completing search without scores:', rankingError)
        await emitPipelineEvent(data.searchId, 'final_ranking_error', 'error', 'Final ranking failed; showing unscored results', String(rankingError), undefined, sseManager)
      }

      session.status = 'complete'
      session.completedAt = new Date()
      session.jobsScored = (session.jobsScored || 0) + scores.length
      await session.save()

      // Broadcast completion status
      sseManager.broadcast(data.searchId, {
        type: 'status',
        payload: {
          status: 'complete',
          iterationCount: session.iterationCount,
          companiesDiscovered: session.companiesDiscovered,
          companiesCrawled: session.companiesCrawled,
          companiesRemaining: session.companiesRemaining,
          jobsExtracted: session.jobsExtracted,
          jobsFilteredOut: session.jobsFilteredOut,
          jobsScored: session.jobsScored
        }
      })

      console.log('Search session complete:', data.searchId)
    } catch (error) {
      console.error('Error in search_complete handler:', error)
      // Rethrow so BullMQ retries transient LLM/DB failures; the queue layer
      // marks the session failed once retries are exhausted.
      throw error
    }
  },

  search_failed: async (data: { searchId: string; error: string }, sseManager: SSEManager) => {
    try {
      console.log('Search failed handler:', data.searchId, data.error)
      await emitPipelineEvent(data.searchId, 'search_failed', 'error', 'Search failed', data.error, { error: data.error }, sseManager)
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
