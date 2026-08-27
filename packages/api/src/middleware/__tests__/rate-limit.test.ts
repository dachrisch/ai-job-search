import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import { registerRateLimiter, loginRateLimiter } from '../rate-limit.js'

function buildApp(limiter: ReturnType<typeof registerRateLimiter>) {
  const app = express()
  app.use(express.json())
  app.post('/target', limiter, (req, res) => res.status(200).json({ ok: true }))
  return app
}

async function hitUntilLimited(app: express.Express, max: number) {
  let limited = false
  for (let i = 0; i < max + 2; i++) {
    const res = await request(app).post('/target').send({})
    if (res.status === 429) {
      limited = true
      break
    }
    expect(res.status).toBe(200)
  }
  return limited
}

describe('auth rate limiting (audit E3)', () => {
  it('limits registration to 5 requests per minute', async () => {
    const app = buildApp(registerRateLimiter)
    expect(await hitUntilLimited(app, 5)).toBe(true)
  })

  it('limits login to 10 requests per minute', async () => {
    const app = buildApp(loginRateLimiter)
    expect(await hitUntilLimited(app, 10)).toBe(true)
  })
})
