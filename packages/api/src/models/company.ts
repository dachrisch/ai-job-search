import mongoose, { Schema, Document, Model } from 'mongoose'
import type { Company } from '@job-search/shared'

/**
 * CompanyDocument extends the Company type from shared types
 * with Mongoose-specific properties like _id and timestamps
 */
export interface CompanyDocument extends Company, Document {
  _id: mongoose.Types.ObjectId
}

const CompanySchema = new Schema<CompanyDocument>(
  {
    url: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      index: true
    },
    name: {
      type: String,
      required: true
    },
    location: {
      type: String
    },
    industry: {
      type: String
    },
    discoveredFrom: {
      type: String,
      enum: ['searxng', 'manual'],
      required: true
    },
    searchQuery: {
      type: String,
      required: true,
      index: true
    },
    confidence: {
      type: String,
      enum: ['high', 'medium', 'low'],
      default: 'medium'
    },
    status: {
      type: String,
      enum: ['pending_crawl', 'crawling', 'crawled', 'failed'],
      required: true,
      default: 'pending_crawl',
      index: true
    },
    crawlAttempts: {
      type: Number,
      default: 0
    },
    lastCrawlTime: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true
  }
)

// Compound index for efficient queries by search query and status
CompanySchema.index({ searchQuery: 1, status: 1 })

// Index for finding pending crawls ordered by creation time
CompanySchema.index({ status: 1, createdAt: -1 })

/**
 * CompanyModel provides database access to Company documents
 *
 * Used for:
 * - Discovering and storing company career pages
 * - Tracking crawl status and attempts
 * - Querying companies by search term and crawl status
 */
export const CompanyModel: Model<CompanyDocument> = mongoose.model<CompanyDocument>(
  'Company',
  CompanySchema
)
