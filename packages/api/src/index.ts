import express, { Express, Request, Response, NextFunction } from 'express'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import mongoose from 'mongoose'
import { connectDB } from './db/index.js'
import { getRedisClient } from './db/redis-health.js'
import { registerEventHandlers, initializeQueue } from './events/queue.js'
import { eventHandlers } from './events/handlers.js'
import { startSweeper } from './events/sweeper.js'
import { startDenylistCleanup } from './auth/denylist.js'
import authRoutes from './routes/auth.js'
import { streamRouter } from './routes/stream.js'
import { SSEManager } from './utils/SSEManager.js'
import searchRoutes from './routes/searches.js'
import insightsRoutes from './routes/insights.js'
import { globalRateLimiter } from './middleware/rate-limit.js'
import { HealthResponse, HealthStatus, ServiceHealth } from '@job-search/shared'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env') })
dotenv.config({ path: path.resolve(__dirname, '../../.env') })

async function checkMongo(): Promise<ServiceHealth> {
  const start = Date.now()
  try {
    if (mongoose.connection.readyState !== 1) {
      return { status: 'down', error: 'Not connected' }
    }
    await mongoose.connection.db!.admin().ping()
    return { status: 'up', responseTimeMs: Date.now() - start }
  } catch (err: any) {
    return { status: 'down', responseTimeMs: Date.now() - start, error: err?.message }
  }
}

async function checkRedis(): Promise<ServiceHealth> {
  const start = Date.now()
  try {
    const client = getRedisClient()
    const pong = await client.ping()
    if (pong !== 'PONG') {
      return { status: 'down', responseTimeMs: Date.now() - start, error: 'Unexpected ping response' }
    }
    return { status: 'up', responseTimeMs: Date.now() - start }
  } catch (err: any) {
    return { status: 'down', responseTimeMs: Date.now() - start, error: err?.message }
  }
}

/**
 * Creates and configures the Express app
 * This is separated from server startup to allow testing
 */
export function createApp(): { app: Express; sseManager: SSEManager } {
  const app: Express = express()
  const sseManager = new SSEManager()

  app.use(express.json())

  // Global per-IP rate limit (audit finding E3). Auth endpoints additionally
  // have their own tighter limits applied in their router.
  app.use(globalRateLimiter)

  app.use('/api/auth', authRoutes)
  app.use('/api/searches', streamRouter(sseManager))
  app.use('/api/searches', searchRoutes)
  app.use('/api/searches', insightsRoutes)

  app.get('/api/health', async (req: Request, res: Response) => {
    const [mongodb, redis] = await Promise.all([checkMongo(), checkRedis()])

    let status: HealthStatus = 'ok'
    if (mongodb.status === 'down') {
      // MongoDB is the primary data store — if it's unavailable the service
      // cannot serve requests meaningfully.
      status = 'down'
    } else if (redis.status === 'down') {
      status = 'degraded'
    }

    const body: HealthResponse = {
      status,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      services: { mongodb, redis },
    }

    res.status(status === 'down' ? 503 : 200).json(body)
  })

  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    console.error('Error:', err)
    res.status(err.status || 500).json({ error: err.message || 'Internal server error' })
  })

  return { app, sseManager }
}

const { app, sseManager } = createApp()
const PORT = process.env.PORT || 3000

async function startServer() {
  try {
    console.log('[1/4] Connecting to database...')
    await connectDB()
    console.log('[2/4] Database connected')

    console.log('[3/4] Initializing event queue...')
    await initializeQueue()
    console.log('  Event queue initialized')

    console.log('[4/4] Registering event handlers...')
    const worker = registerEventHandlers(eventHandlers, sseManager)
    console.log('  Event handlers registered')

    console.log('[5/5] Starting server...')
    app.listen(PORT, () => {
      console.log(`✅ Server running on port ${PORT}`)
    })

    // Watch for stuck `running` searches and mark them failed (A2).
    startSweeper(sseManager)

    // Periodic cleanup of expired denylist entries.
    startDenylistCleanup()
  } catch (error) {
    console.error('❌ Failed to start server:', error)
    process.exit(1)
  }
}

// Only start server if not in a test environment
if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  startServer()
}

export default app
export { sseManager }
export { startServer }
