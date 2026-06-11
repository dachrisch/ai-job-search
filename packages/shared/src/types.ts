export interface User {
  _id: string
  email: string
  passwordHash: string
  claudeApiToken?: string
  createdAt: Date
  updatedAt: Date
}

export interface Job {
  _id: string
  title: string
  company: string
  description: string
  url: string
  salary?: string
  location: string
  sourceUrl: string
  discoveredAt: Date
  matchScore?: number
  matchReasoning?: string
  searchSessionId: string
  companyId?: string
  discoveryMethod: 'company_page'
  keywordMatchScore?: number
  keywordMatchReasoning?: string
  extractedAt: Date
  scoredAt?: Date
  scoredVersion: number
}

export interface Company {
  _id: string
  url: string
  name: string
  location?: string
  industry?: string
  searchQuery: string
  discoveredFrom: 'searxng' | 'manual'
  confidence?: 'high' | 'medium' | 'low'
  status: 'pending_crawl' | 'crawling' | 'crawled' | 'failed'
  crawlAttempts: number
  lastCrawlTime?: Date
  createdAt: Date
  updatedAt: Date
}

export interface Site {
  _id: string
  domain: string
  jobBoardUrl: string
  lastCrawled?: Date
  discoveryMethod: 'searxng_search' | 'crawler_discovery' | 'user_provided'
  createdAt: Date
}

export interface SearchSession {
  _id: string
  userId: string
  query: string
  status: 'running' | 'complete' | 'failed'
  searchPhase?: 'initial' | 'refined'
  searchQueries?: string[]
  discoveredPages?: string[]
  scrapedPages?: string[]
  claudeConversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>
  foundJobs: string[]
  sitesSearched: string[]
  iterationCount: number
  startedAt: Date
  completedAt?: Date
  createdAt: Date
  companiesDiscovered: number
  companiesCrawled: number
  companiesRemaining: number
  jobsExtracted: number
  jobsScored: number
  currentCrawlBatch: number
  expandedSearch: boolean
}

export interface AuthResponse {
  userId: string
  token: string
}

export interface SearchResponse {
  searchId: string
  status: 'running' | 'complete' | 'failed'
}

export interface JobResult {
  id: string
  title: string
  company: string
  description: string
  url: string
  salary?: string
  location: string
  matchScore: number
  matchReasoning: string
}

export interface CrawlerResponse {
  found: number
  jobs: Array<{
    title: string
    company: string
    description: string
    url: string
    salary?: string
    location: string
  }>
  newSites?: string[]
}

export interface ClaudeSearchSuggestion {
  sites: string[]
  keywords: string
}

export interface ClaudeRankingResult {
  jobId: string
  matchScore: number
  reasoning: string
}

export interface DiscoveredCompany {
  url: string
  name: string
  title: string                  // page title from search result
  snippet: string                // search result snippet
  confidence: 'high' | 'medium' | 'low'
}
