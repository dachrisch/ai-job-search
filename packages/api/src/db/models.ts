import mongoose, { Schema, Model } from 'mongoose'
import type { User, Job, Site, SearchSession, Company } from '@job-search/shared'

const userSchema = new Schema<User>(
  {
    email: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    claudeApiToken: { type: String },
  },
  { timestamps: true }
)

const jobSchema = new Schema<Job>({
  title: { type: String, required: true },
  company: { type: String, required: true },
  description: { type: String, required: true },
  url: { type: String, required: true },
  salary: { type: String },
  location: { type: String, required: true },
  sourceUrl: { type: String, required: true },
  discoveredAt: { type: Date, required: true },
  matchScore: { type: Number },
  matchReasoning: { type: String },
  searchSessionId: { type: String, required: true, index: true },
  companyId: { type: Schema.Types.ObjectId, ref: 'Company' },
  discoveryMethod: { type: String, enum: ['company_page'], required: true, default: 'company_page' },
  keywordMatchScore: { type: Number, min: 0, max: 1 },
  keywordMatchReasoning: { type: String },
  extractedAt: { type: Date, required: true },
  scoredAt: { type: Date },
  scoredVersion: { type: Number, required: true, default: 0 },
})

const siteSchema = new Schema<Site>(
  {
    domain: { type: String, required: true, unique: true },
    jobBoardUrl: { type: String, required: true },
    lastCrawled: { type: Date },
    discoveryMethod: {
      type: String,
      enum: ['searxng_search', 'crawler_discovery', 'user_provided'],
      required: true,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
)

const companySchema = new Schema<Company>(
  {
    url: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    location: { type: String },
    industry: { type: String },
    searchQuery: { type: String, required: true, index: true },
    discoveredFrom: { type: String, required: true },
    status: {
      type: String,
      enum: ['pending_crawl', 'crawling', 'crawled', 'failed'],
      required: true,
      index: true,
      default: 'pending_crawl',
    },
    crawlAttempts: { type: Number, default: 0 },
    lastCrawlTime: { type: Date },
  },
  { timestamps: true }
)

const searchSessionSchema = new Schema<SearchSession>(
  {
    userId: { type: String, required: true, index: true },
    query: { type: String, required: true },
    status: { type: String, enum: ['running', 'complete', 'failed'], required: true },
    // Discovery tracking fields
    searchPhase: { type: String, enum: ['initial', 'refined'], default: 'initial' },
    searchQueries: [String],
    discoveredPages: [String],
    scrapedPages: [String],
    claudeConversationHistory: [
      {
        role: { type: String, enum: ['user', 'assistant'], required: true },
        content: { type: String, required: true },
      },
    ],
    foundJobs: [String],
    sitesSearched: [String],
    iterationCount: { type: Number, required: true },
    startedAt: { type: Date, required: true },
    completedAt: { type: Date },
    companiesDiscovered: { type: Number, required: true, default: 0 },
    companiesCrawled: { type: Number, required: true, default: 0 },
    companiesRemaining: { type: Number, required: true, default: 0 },
    jobsExtracted: { type: Number, required: true, default: 0 },
    jobsScored: { type: Number, required: true, default: 0 },
    currentCrawlBatch: { type: Number, required: true, default: 1 },
    expandedSearch: { type: Boolean, required: true, default: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
)

// Helper to get or create models, avoiding OverwriteModelError in tests
function getModel<T>(name: string, schema: Schema): Model<T> {
  try {
    return mongoose.model(name)
  } catch (error) {
    // Model doesn't exist yet, create it
    return mongoose.model<T>(name, schema)
  }
}

export const UserModel: Model<User> = getModel<User>('User', userSchema)
export const JobModel: Model<Job> = getModel<Job>('Job', jobSchema)
export const SiteModel: Model<Site> = getModel<Site>('Site', siteSchema)
export const CompanyModel: Model<Company> = getModel<Company>('Company', companySchema)
export const SearchSessionModel: Model<SearchSession> = getModel<SearchSession>(
  'SearchSession',
  searchSessionSchema
)
