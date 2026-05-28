import mongoose, { Schema, Model } from 'mongoose'
import type { User, Job, Site, SearchSession } from '@job-search/shared'

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
  },
  { timestamps: { createdAt: true, updatedAt: false } }
)

export const UserModel: Model<User> = mongoose.model('User', userSchema)
export const JobModel: Model<Job> = mongoose.model('Job', jobSchema)
export const SiteModel: Model<Site> = mongoose.model('Site', siteSchema)
export const SearchSessionModel: Model<SearchSession> = mongoose.model(
  'SearchSession',
  searchSessionSchema
)
