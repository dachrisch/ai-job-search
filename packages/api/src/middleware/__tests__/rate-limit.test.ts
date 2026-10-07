import { describe, it, expect, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import { registerRateLimiter, loginRateLimiter } from '../rate-limit.js'
import { createApp } from '../../index.js'

function buildApp(limiter: express.RequestHandler) {
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

describe('trust proxy (issue #187)', () => {
  it('enables trust proxy so the limiter keys off the real client IP', () => {
    const { app } = createApp()
    expect(app.get('trust proxy')).toBe(1)
  })

  it('does not log ERR_ERL_UNEXPECTED_X_FORWARDED_FOR on proxied requests', async () => {
    const { app } = createApp()
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await request(app).get('/api/health').set('X-Forwarded-For', '1.2.3.4')
      const logged = errSpy.mock.calls.flat().map(String).join('\n')
      expect(logged).not.toContain('ERR_ERL_UNEXPECTED_X_FORWARDED_FOR')
    } finally {
      errSpy.mockRestore()
    }
  })
})
