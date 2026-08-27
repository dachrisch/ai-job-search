import Redis from 'ioredis'

// Singleton ioredis client used only for lightweight liveness checks
// (e.g. the /api/health endpoint). The BullMQ queue manages its own
// connection; this one is kept separate to avoid coupling health checks to
// queue lifecycle.
let client: Redis | null = null

export function getRedisClient(): Redis {
  if (!client) {
    client = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: 1,
      connectTimeout: 3000,
      lazyConnect: true,
    })
  }
  return client
}
