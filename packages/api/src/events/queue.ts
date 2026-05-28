import { Queue, Worker } from 'bullmq'
import { createClient } from 'redis'

const redisConnection = {
  url: process.env.REDIS_URL || 'redis://localhost:6379'
}

let eventQueue: Queue

export function getQueue() {
  if (!eventQueue) {
    eventQueue = new Queue('job-search-events', { connection: redisConnection as any })
  }
  return eventQueue
}

export async function addEvent(eventType: string, data: any) {
  const queue = getQueue()
  const job = await queue.add(eventType, data, { removeOnComplete: true })
  return job.id
}

export function registerEventHandlers(handlers: Record<string, (data: any) => Promise<void>>) {
  const queue = getQueue()

  const worker = new Worker('job-search-events', async (job) => {
    const handler = handlers[job.name]
    if (handler) {
      await handler(job.data)
    } else {
      console.warn(`No handler for event: ${job.name}`)
    }
  }, { connection: redisConnection as any })

  worker.on('completed', (job) => {
    console.log(`Event processed: ${job.name}`)
  })

  worker.on('failed', (job, err) => {
    console.error(`Event failed: ${job?.name}`, err)
  })

  return worker
}

export const eventHandlers: Record<string, () => Promise<void>> = {}

export function getEventHandlers() {
  return eventHandlers
}
