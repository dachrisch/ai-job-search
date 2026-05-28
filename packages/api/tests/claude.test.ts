import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { callClaude } from '../src/claude/client'
import { connectDB, disconnectDB } from '../src/db'
import { UserModel } from '../src/db/models'
import { MongoMemoryServer } from 'mongodb-memory-server'

let mongoServer: MongoMemoryServer

describe('Claude API Client', () => {
  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create()
    const mongoUri = mongoServer.getUri()
    process.env.MONGODB_URI = mongoUri
    await connectDB()
  })

  afterAll(async () => {
    await disconnectDB()
    await mongoServer.stop()
  })

  beforeEach(async () => {
    await UserModel.deleteMany({})
  })

  afterEach(async () => {
    // Cleanup
  })

  it('should call Claude API with user token', async () => {
    const user = await UserModel.create({
      email: 'test@example.com',
      passwordHash: 'hash',
      claudeApiToken: process.env.CLAUDE_API_KEY || 'test-token',
    })

    if (!process.env.CLAUDE_API_KEY) {
      console.log('Skipping test: CLAUDE_API_KEY not set')
      return
    }

    const response = await callClaude(user._id.toString(), 'Hello Claude')
    expect(response).toBeTypeOf('string')
    expect(response.length).toBeGreaterThan(0)
  })

  it('should return mock response if user has no Claude token', async () => {
    const user = await UserModel.create({
      email: 'test@example.com',
      passwordHash: 'hash',
    })

    const response = await callClaude(user._id.toString(), 'Hello Claude')
    expect(response).toBeTypeOf('string')
    expect(response).toContain('Mock response')
  })
})
