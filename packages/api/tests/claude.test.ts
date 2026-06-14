import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { callClaude } from '../src/claude/client'
import { connectDB, disconnectDB } from '../src/db'
import { UserModel } from '../src/db/models'
import { MongoMemoryServer } from 'mongodb-memory-server'

let mongoServer: MongoMemoryServer

describe.skipIf(process.env.CI)('Claude API Client', () => {
  beforeAll(async () => {
    try {
      mongoServer = await MongoMemoryServer.create()
      const mongoUri = mongoServer.getUri()
      process.env.MONGODB_URI = mongoUri
    } catch (error) {
      console.log('MongoMemoryServer failed to start:', error)
    }
    await connectDB()
  })

  afterAll(async () => {
    await disconnectDB()
    if (mongoServer) {
      await mongoServer.stop()
    }
  })

  beforeEach(async () => {
    await UserModel.deleteMany({})
  })

  afterEach(async () => {
    // Cleanup
  })

  it.skipIf(!process.env.TEST_CLAUDE_TOKEN)('should call Claude API with user token', async () => {
    const user = await UserModel.create({
      email: 'test@example.com',
      passwordHash: 'hash',
      claudeApiToken: process.env.TEST_CLAUDE_TOKEN,
    })

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
    expect(response).toContain('sites')
    expect(response).toContain('linkedin.com')
  })
})
