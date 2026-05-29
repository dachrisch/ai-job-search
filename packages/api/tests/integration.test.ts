import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import axios from 'axios'
import { connectDB, disconnectDB } from '../src/db'

const BASE_URL = 'http://localhost:3000/api'

describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)('Integration Tests', () => {
  let userId: string
  let token: string
  let searchId: string

  const createClient = () =>
    axios.create({
      baseURL: BASE_URL,
      validateStatus: () => true
    })

  beforeAll(async () => {
    try {
      await connectDB()
    } catch (error) {
      console.log('Note: Database connection skipped (server may be running separately)')
    }
  })

  afterAll(async () => {
    try {
      await disconnectDB()
    } catch (error) {
      // May already be disconnected
    }
  })

  it('Test 1: Register a new user - should return userId and token', async () => {
    const client = createClient()
    const email = `test-${Date.now()}@example.com`
    const password = 'password123'

    const response = await client.post('/auth/register', {
      email,
      password
    })

    expect(response.status).toBe(201)
    expect(response.data.userId).toBeDefined()
    expect(response.data.token).toBeDefined()
    expect(typeof response.data.userId).toBe('string')
    expect(typeof response.data.token).toBe('string')

    userId = response.data.userId
    token = response.data.token
  })

  it.skip('Test 2: Set Claude token - should succeed with Bearer auth', async () => {
    const client = createClient()
    const claudeToken = 'sk-ant-test-token-' + Date.now()

    const response = await client.post(
      '/auth/set-claude-token',
      { claudeToken },
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    )

    expect(response.status).toBe(200)
    expect(response.data.success).toBe(true)
  })

  it('Test 3: Create a search - should return searchId with running status', async () => {
    const client = createClient()
    const response = await client.post(
      '/searches',
      { query: 'Senior React Developer' },
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    )

    expect(response.status).toBe(201)
    expect(response.data.searchId).toBeDefined()
    expect(response.data.status).toBe('running')
    expect(typeof response.data.searchId).toBe('string')

    searchId = response.data.searchId
  })

  it('Test 4: Get search status - should return search details', async () => {
    const client = createClient()
    const response = await client.get(`/searches/${searchId}`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    })

    expect(response.status).toBe(200)
    expect(response.data.searchId).toBe(searchId)
    expect(response.data.status).toBe('running')
    expect(response.data.query).toBe('Senior React Developer')
    expect(response.data.iterationCount).toBeDefined()
    expect(response.data.foundJobsCount).toBeDefined()
  })

  it('Test 5: Get empty results for incomplete search - should return empty array', async () => {
    const client = createClient()
    const response = await client.get(`/searches/${searchId}/jobs`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    })

    expect(response.status).toBe(200)
    expect(response.data.jobs).toBeDefined()
    expect(Array.isArray(response.data.jobs)).toBe(true)
    expect(response.data.jobs.length).toBe(0)
  })
})
