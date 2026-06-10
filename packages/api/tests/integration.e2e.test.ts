import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import mongoose from 'mongoose'
import { UserModel, CompanyModel, JobModel, SearchSessionModel } from '../src/db/models.js'
import { createApp } from '../src/index.js'
import { connectDB, disconnectDB } from '../src/db/index.js'

// Create the app for testing (without starting the server)
const { app } = createApp()

/**
 * End-to-End Integration Tests for Company Search Workflow
 *
 * These tests verify the complete flow of:
 * 1. User registration and authentication
 * 2. Creating search sessions
 * 3. Storing companies
 * 4. Retrieving paginated jobs
 * 5. Accessing search status
 * 6. Verifying pagination and sorting
 * 7. Authorization controls
 *
 * To run these tests, use the MongoDB infrastructure on servyy-test.lxd:
 * 1. Ensure MongoDB is running on 10.185.182.250:27017
 * 2. Run: npm test -- tests/integration.e2e.test.ts --run
 */

describe.skipIf(process.env.CI === 'true' || process.env.RUN_INTEGRATION_TESTS !== 'true')('Company-Focused Search E2E', () => {
  let authToken1: string
  let userId1: string
  let authToken2: string
  let userId2: string

  beforeAll(async () => {
    // Connect to test MongoDB (assumes servyy-test.lxd infrastructure is running)
    try {
      await connectDB()
      console.log('Connected to test database')
    } catch (error) {
      console.error('Failed to connect to test database:', error)
      throw new Error('Cannot run E2E tests without MongoDB. Ensure servyy-test.lxd infrastructure is running.')
    }
  })

  afterAll(async () => {
    // Disconnect from MongoDB
    try {
      await disconnectDB()
      console.log('Disconnected from test database')
    } catch (error) {
      // Ignore disconnection errors in cleanup
    }
  })

  beforeEach(async () => {
    // Clear all test collections before each test
    await UserModel.deleteMany({})
    await CompanyModel.deleteMany({})
    await JobModel.deleteMany({})
    await SearchSessionModel.deleteMany({})
  })

  afterEach(async () => {
    // Additional cleanup after each test
    await UserModel.deleteMany({})
    await CompanyModel.deleteMany({})
    await JobModel.deleteMany({})
    await SearchSessionModel.deleteMany({})
  })

  /**
   * Test 1: Creates user and authenticates
   * Verifies user registration returns token and userId
   */
  it('creates user and authenticates', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'test@e2e.com',
        password: 'testpass123'
      })

    expect(response.status).toBe(201)
    expect(response.body).toHaveProperty('token')
    expect(response.body).toHaveProperty('userId')
    expect(response.body.token).toBeTypeOf('string')
    expect(response.body.userId).toBeTypeOf('string')

    // Store for subsequent tests
    authToken1 = response.body.token
    userId1 = response.body.userId

    // Verify token is valid by attempting authenticated request
    const verifyResponse = await request(app)
      .get(`/api/searches/${new mongoose.Types.ObjectId()}`)
      .set('Authorization', `Bearer ${authToken1}`)

    // Should fail with "search not found" not "unauthorized"
    expect(verifyResponse.status).toBe(404)
    expect(verifyResponse.body).toHaveProperty('error', 'Search not found')
  })

  /**
   * Test 2: Creates search session
   * Verifies search session is created with running status
   */
  it('creates search session', async () => {
    // First register user
    const authResponse = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'test2@e2e.com',
        password: 'testpass123'
      })

    const token = authResponse.body.token

    // Then create search
    const searchResponse = await request(app)
      .post('/api/searches')
      .set('Authorization', `Bearer ${token}`)
      .send({
        query: 'python engineer'
      })

    expect(searchResponse.status).toBe(201)
    expect(searchResponse.body).toHaveProperty('searchId')
    expect(searchResponse.body).toHaveProperty('status', 'running')
    expect(searchResponse.body.searchId).toBeTypeOf('string')
  })

  /**
   * Test 3: Stores companies
   * Verifies company documents are created with correct status
   */
  it('stores companies', async () => {
    const company = await CompanyModel.create({
      url: 'https://careers.testcompany.com',
      name: 'Test Company',
      location: 'San Francisco',
      searchQuery: 'python engineer',
      discoveredFrom: 'search_results',
      status: 'pending_crawl',
      crawlAttempts: 0
    })

    expect(company._id).toBeDefined()
    expect(company.status).toBe('pending_crawl')
    expect(company.url).toBe('https://careers.testcompany.com')
    expect(company.name).toBe('Test Company')

    // Verify it's retrievable from database
    const retrieved = await CompanyModel.findById(company._id)
    expect(retrieved).toBeDefined()
    expect(retrieved?.status).toBe('pending_crawl')
  })

  /**
   * Test 4: Retrieves paginated jobs
   * Verifies jobs are returned with correct pagination metadata
   */
  it('retrieves paginated jobs', async () => {
    // Register user
    const authResponse = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'test3@e2e.com',
        password: 'testpass123'
      })

    const token = authResponse.body.token
    const userId = authResponse.body.userId

    // Create search session
    const sessionId = new mongoose.Types.ObjectId()
    const session = await SearchSessionModel.create({
      _id: sessionId,
      userId,
      query: 'python engineer',
      status: 'complete',
      claudeConversationHistory: [],
      foundJobs: [],
      sitesSearched: [],
      iterationCount: 1,
      startedAt: new Date(),
      companiesDiscovered: 1,
      companiesCrawled: 1,
      companiesRemaining: 0,
      jobsExtracted: 2,
      jobsScored: 2,
      currentCrawlBatch: 1,
      expandedSearch: false
    })

    // Create test jobs
    const now = new Date()
    await JobModel.create([
      {
        title: 'Senior Python Engineer',
        company: 'Test Company',
        description: 'Senior role',
        url: 'https://example.com/job1',
        location: 'San Francisco',
        sourceUrl: 'https://careers.testcompany.com',
        discoveredAt: now,
        extractedAt: now,
        matchScore: 0.95,
        matchReasoning: 'Excellent match',
        searchSessionId: sessionId.toString(),
        discoveryMethod: 'company_page',
        scoredAt: now,
        scoredVersion: 0
      },
      {
        title: 'Python Developer',
        company: 'Test Company',
        description: 'Developer role',
        url: 'https://example.com/job2',
        location: 'San Francisco',
        sourceUrl: 'https://careers.testcompany.com',
        discoveredAt: now,
        extractedAt: now,
        matchScore: 0.85,
        matchReasoning: 'Good match',
        searchSessionId: sessionId.toString(),
        discoveryMethod: 'company_page',
        scoredAt: now,
        scoredVersion: 0
      }
    ])

    // Retrieve jobs with pagination
    const jobsResponse = await request(app)
      .get(`/api/searches/${sessionId.toString()}/jobs`)
      .set('Authorization', `Bearer ${token}`)
      .query({ page: 1, pageSize: 10 })

    expect(jobsResponse.status).toBe(200)
    expect(jobsResponse.body).toHaveProperty('jobs')
    expect(jobsResponse.body.jobs).toHaveLength(2)
    expect(jobsResponse.body).toHaveProperty('page', 1)
    expect(jobsResponse.body).toHaveProperty('pageSize', 10)
    expect(jobsResponse.body).toHaveProperty('totalJobs', 2)
    expect(jobsResponse.body).toHaveProperty('totalPages', 1)
    expect(jobsResponse.body).toHaveProperty('hasMore', false)
    expect(jobsResponse.body).toHaveProperty('isLoading', false)
  })

  /**
   * Test 5: Retrieves search status
   * Verifies search status endpoint returns tracking information
   */
  it('retrieves search status', async () => {
    // Register user
    const authResponse = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'test4@e2e.com',
        password: 'testpass123'
      })

    const token = authResponse.body.token
    const userId = authResponse.body.userId

    // Create search session with tracking fields
    const sessionId = new mongoose.Types.ObjectId()
    await SearchSessionModel.create({
      _id: sessionId,
      userId,
      query: 'python engineer',
      status: 'complete',
      claudeConversationHistory: [],
      foundJobs: [],
      sitesSearched: [],
      iterationCount: 1,
      startedAt: new Date(),
      completedAt: new Date(),
      companiesDiscovered: 1,
      companiesCrawled: 1,
      companiesRemaining: 0,
      jobsExtracted: 2,
      jobsScored: 2,
      currentCrawlBatch: 1,
      expandedSearch: false
    })

    // Create test jobs
    const now = new Date()
    await JobModel.create([
      {
        title: 'Senior Python Engineer',
        company: 'Test Company',
        description: 'Senior role',
        url: 'https://example.com/job1',
        location: 'San Francisco',
        sourceUrl: 'https://careers.testcompany.com',
        discoveredAt: now,
        extractedAt: now,
        matchScore: 0.95,
        searchSessionId: sessionId.toString(),
        discoveryMethod: 'company_page',
        scoredAt: now,
        scoredVersion: 0
      },
      {
        title: 'Python Developer',
        company: 'Test Company',
        description: 'Developer role',
        url: 'https://example.com/job2',
        location: 'San Francisco',
        sourceUrl: 'https://careers.testcompany.com',
        discoveredAt: now,
        extractedAt: now,
        matchScore: 0.85,
        searchSessionId: sessionId.toString(),
        discoveryMethod: 'company_page',
        scoredAt: now,
        scoredVersion: 0
      }
    ])

    // Get search status
    const statusResponse = await request(app)
      .get(`/api/searches/${sessionId.toString()}/status`)
      .set('Authorization', `Bearer ${token}`)

    expect(statusResponse.status).toBe(200)
    expect(statusResponse.body).toHaveProperty('status', 'complete')
    expect(statusResponse.body).toHaveProperty('jobsExtracted', 2)
    expect(statusResponse.body).toHaveProperty('companiesDiscovered', 1)
    expect(statusResponse.body).toHaveProperty('jobsScored', 2)
    expect(statusResponse.body).toHaveProperty('companiesCrawled', 1)
    expect(statusResponse.body).toHaveProperty('companiesRemaining', 0)
  })

  /**
   * Test 6: Pagination works correctly
   * Verifies page 1 and page 2 work with hasMore flag
   */
  it('pagination works correctly', async () => {
    // Register user
    const authResponse = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'test5@e2e.com',
        password: 'testpass123'
      })

    const token = authResponse.body.token
    const userId = authResponse.body.userId

    // Create search session
    const sessionId = new mongoose.Types.ObjectId()
    await SearchSessionModel.create({
      _id: sessionId,
      userId,
      query: 'python engineer',
      status: 'complete',
      claudeConversationHistory: [],
      foundJobs: [],
      sitesSearched: [],
      iterationCount: 1,
      startedAt: new Date(),
      companiesDiscovered: 1,
      companiesCrawled: 1,
      companiesRemaining: 0,
      jobsExtracted: 15,
      jobsScored: 15,
      currentCrawlBatch: 1,
      expandedSearch: false
    })

    // Create 15 test jobs
    const now = new Date()
    const jobs = Array.from({ length: 15 }, (_, i) => ({
      title: `Python Job ${i + 1}`,
      company: 'Test Company',
      description: `Job description ${i + 1}`,
      url: `https://example.com/job${i + 1}`,
      location: 'San Francisco',
      sourceUrl: 'https://careers.testcompany.com',
      discoveredAt: now,
      extractedAt: now,
      matchScore: 0.9 - i * 0.01,
      searchSessionId: sessionId.toString(),
      discoveryMethod: 'company_page' as const,
      scoredAt: now,
      scoredVersion: 0
    }))

    await JobModel.create(jobs)

    // Request page 1
    const page1Response = await request(app)
      .get(`/api/searches/${sessionId.toString()}/jobs`)
      .set('Authorization', `Bearer ${token}`)
      .query({ page: 1, pageSize: 10 })

    expect(page1Response.status).toBe(200)
    expect(page1Response.body.jobs).toHaveLength(10)
    expect(page1Response.body).toHaveProperty('page', 1)
    expect(page1Response.body).toHaveProperty('totalPages', 2)
    expect(page1Response.body).toHaveProperty('hasMore', true)
    expect(page1Response.body).toHaveProperty('totalJobs', 15)

    // Request page 2
    const page2Response = await request(app)
      .get(`/api/searches/${sessionId.toString()}/jobs`)
      .set('Authorization', `Bearer ${token}`)
      .query({ page: 2, pageSize: 10 })

    expect(page2Response.status).toBe(200)
    expect(page2Response.body.jobs).toHaveLength(5)
    expect(page2Response.body).toHaveProperty('page', 2)
    expect(page2Response.body).toHaveProperty('totalPages', 2)
    expect(page2Response.body).toHaveProperty('hasMore', false)
    expect(page2Response.body).toHaveProperty('totalJobs', 15)
  })

  /**
   * Test 7: Jobs sorted by match score
   * Verifies jobs are returned in descending order by matchScore
   */
  it('jobs sorted by match score', async () => {
    // Register user
    const authResponse = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'test6@e2e.com',
        password: 'testpass123'
      })

    const token = authResponse.body.token
    const userId = authResponse.body.userId

    // Create search session
    const sessionId = new mongoose.Types.ObjectId()
    await SearchSessionModel.create({
      _id: sessionId,
      userId,
      query: 'python engineer',
      status: 'complete',
      claudeConversationHistory: [],
      foundJobs: [],
      sitesSearched: [],
      iterationCount: 1,
      startedAt: new Date(),
      companiesDiscovered: 1,
      companiesCrawled: 1,
      companiesRemaining: 0,
      jobsExtracted: 3,
      jobsScored: 3,
      currentCrawlBatch: 1,
      expandedSearch: false
    })

    // Create jobs with different match scores
    const now = new Date()
    const scoredAt = new Date(now.getTime() + 1000) // Slightly later
    await JobModel.create([
      {
        title: 'Job A',
        company: 'Company A',
        description: 'Description A',
        url: 'https://example.com/jobA',
        location: 'San Francisco',
        sourceUrl: 'https://careers.com/a',
        discoveredAt: now,
        extractedAt: now,
        matchScore: 0.9,
        searchSessionId: sessionId.toString(),
        discoveryMethod: 'company_page',
        scoredAt,
        scoredVersion: 0
      },
      {
        title: 'Job B',
        company: 'Company B',
        description: 'Description B',
        url: 'https://example.com/jobB',
        location: 'San Francisco',
        sourceUrl: 'https://careers.com/b',
        discoveredAt: now,
        extractedAt: now,
        matchScore: 0.7,
        searchSessionId: sessionId.toString(),
        discoveryMethod: 'company_page',
        scoredAt,
        scoredVersion: 0
      },
      {
        title: 'Job C',
        company: 'Company C',
        description: 'Description C',
        url: 'https://example.com/jobC',
        location: 'San Francisco',
        sourceUrl: 'https://careers.com/c',
        discoveredAt: now,
        extractedAt: now,
        matchScore: 0.95,
        searchSessionId: sessionId.toString(),
        discoveryMethod: 'company_page',
        scoredAt,
        scoredVersion: 0
      }
    ])

    // Get jobs
    const jobsResponse = await request(app)
      .get(`/api/searches/${sessionId.toString()}/jobs`)
      .set('Authorization', `Bearer ${token}`)
      .query({ page: 1, pageSize: 10 })

    expect(jobsResponse.status).toBe(200)
    expect(jobsResponse.body.jobs).toHaveLength(3)

    // Verify order is descending by matchScore [0.95, 0.9, 0.7]
    expect(jobsResponse.body.jobs[0].matchScore).toBe(0.95)
    expect(jobsResponse.body.jobs[1].matchScore).toBe(0.9)
    expect(jobsResponse.body.jobs[2].matchScore).toBe(0.7)
  })

  /**
   * Test 8: Unauthorized access blocked
   * Verifies that users cannot access other users' searches
   */
  it('unauthorized access blocked', async () => {
    // Register two users
    const user1Response = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'user1@e2e.com',
        password: 'password123'
      })

    const user1Token = user1Response.body.token
    const user1Id = user1Response.body.userId

    const user2Response = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'user2@e2e.com',
        password: 'password123'
      })

    const user2Token = user2Response.body.token

    // User 1 creates a search
    const sessionId = new mongoose.Types.ObjectId()
    await SearchSessionModel.create({
      _id: sessionId,
      userId: user1Id,
      query: 'python engineer',
      status: 'complete',
      claudeConversationHistory: [],
      foundJobs: [],
      sitesSearched: [],
      iterationCount: 1,
      startedAt: new Date(),
      companiesDiscovered: 1,
      companiesCrawled: 1,
      companiesRemaining: 0,
      jobsExtracted: 0,
      jobsScored: 0,
      currentCrawlBatch: 1,
      expandedSearch: false
    })

    // User 2 tries to access User 1's search
    const unauthorizedResponse = await request(app)
      .get(`/api/searches/${sessionId.toString()}`)
      .set('Authorization', `Bearer ${user2Token}`)

    expect(unauthorizedResponse.status).toBe(404)
    expect(unauthorizedResponse.body).toHaveProperty('error', 'Search not found')

    // Also verify jobs endpoint returns 404
    const jobsResponse = await request(app)
      .get(`/api/searches/${sessionId.toString()}/jobs`)
      .set('Authorization', `Bearer ${user2Token}`)

    expect(jobsResponse.status).toBe(404)
    expect(jobsResponse.body).toHaveProperty('error', 'Search not found')
  })
})
