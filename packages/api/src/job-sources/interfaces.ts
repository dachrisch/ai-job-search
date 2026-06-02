export interface Job {
  title: string
  company: string
  description: string
  url: string
  location: string
  salary?: string
  sourceUrl: string
  matchScore?: number
  matchReasoning?: string
}

export interface JobScraperResult {
  jobs: Job[]
  errors: Array<{ message: string; site?: string }>
  source: string
  timestamp?: Date
}

export interface ScrapingResult {
  jobs: Job[]
  errors: Array<{ message: string; site?: string }>
  source: string
  timestamp?: Date
}

export interface JobSourceConfig {
  timeout?: number
  maxRetries?: number
  userAgent?: string
}

export interface JobSource {
  name: string
  canHandle(domain: string): boolean
  // New bulk method
  scrapeBulk(urls: string[], keywords: string, config?: JobSourceConfig): Promise<JobScraperResult[]>
  // Deprecating single scrape
  scrape(url: string, keywords: string, config?: JobSourceConfig): Promise<JobScraperResult>
}

export interface SearchResult {
  url: string
  title: string
  snippet: string
  relevanceScore: number
}

export interface SearchOptions {
  timeout?: number
  maxResults?: number
}

export interface AnalyzedPage {
  url: string
  confidence: number // 0-1
  reason: string
  priority: number // 1-10
}

export interface PageAnalysisOptions {
  maxPages?: number
  minConfidence?: number
}

export interface DiscoveredPage {
  url: string
  source: 'pagination' | 'internal_link' | 'discovered'
  priority: number
  discoveredFrom: string // parent URL
}

export interface ScrapingResultWithDiscovery extends ScrapingResult {
  discoveredPages: DiscoveredPage[]
}
