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

export interface JobSourceConfig {
  timeout?: number
  maxRetries?: number
  userAgent?: string
}

export interface JobSource {
  name: string
  canHandle(domain: string): boolean
  scrape(url: string, keywords: string, config?: JobSourceConfig): Promise<JobScraperResult>
}
