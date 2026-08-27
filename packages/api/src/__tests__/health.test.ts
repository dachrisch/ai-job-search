import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockConnection, fakeRedis } = vi.hoisted(() => ({
  mockConnection: {
    readyState: 1,
    db: { admin: () => ({ ping: () => Promise.resolve() }) },
  },
  fakeRedis: { ping: vi.fn() },
}))

vi.mock('mongoose', async (importOriginal) => {
  const actual = (await importOriginal()) as any
  return {
    ...actual,
    default: { ...actual.default, connection: mockConnection },
  }
})

vi.mock('../db/redis-health.js', () => ({
  getRedisClient: () => fakeRedis,
}))

import { createApp } from '../index.js'
import request from 'supertest'

function setMongo(readyState: number, pingRejects = false) {
  mockConnection.readyState = readyState
  mockConnection.db.admin = () =>
    pingRejects
      ? { ping: () => Promise.reject(new Error('mongo down')) }
      : { ping: () => Promise.resolve() }
}

describe('GET /api/health (audit F1)', () => {
  beforeEach(() => {
    fakeRedis.ping.mockResolvedValue('PONG')
  })

  it('reports ok when all dependencies are healthy', async () => {
    setMongo(1)
    const { app } = createApp()
    const res = await request(app).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('ok')
    expect(res.body.services.mongodb.status).toBe('up')
    expect(res.body.services.redis.status).toBe('up')
    expect(typeof res.body.uptime).toBe('number')
    expect(typeof res.body.timestamp).toBe('string')
  })

  it('reports down when MongoDB is unavailable', async () => {
    setMongo(0)
    const { app } = createApp()
    const res = await request(app).get('/api/health')
    expect(res.status).toBe(503)
    expect(res.body.status).toBe('down')
    expect(res.body.services.mongodb.status).toBe('down')
  })

  it('reports degraded when Redis is unavailable', async () => {
    setMongo(1)
    fakeRedis.ping.mockRejectedValue(new Error('redis down'))
    const { app } = createApp()
    const res = await request(app).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('degraded')
    expect(res.body.services.redis.status).toBe('down')
  })
})

