import { Queue, Worker } from 'bullmq'

const redisConnection = {
  url: process.env.REDIS_URL || 'redis://localhost:6379'
}

let eventQueue: Queue | null = null
let usingMemoryQueue = false
let memoryQueueEvents: Array<{ type: string; data: any }> = []
let memoryQueueWorker: ReturnType<typeof setInterval> | null = null

// Try to create a BullMQ queue with Redis
async function createQueue(): Promise<Queue | null> {
  try {
    const queue = new Queue('job-search-events', { connection: redisConnection as any })
    console.log('✅ Redis queue initialized')
    usingMemoryQueue = false
    return queue
  } catch (err: any) {
    console.warn('⚠️ Redis unavailable, using in-memory queue:', err.message)
    usingMemoryQueue = true
    return null
  }
}

export async function initializeQueue() {
  eventQueue = await createQueue()
}

export function getQueue() {
  if (!eventQueue && !usingMemoryQueue) {
    throw new Error('Queue not initialized. Call initializeQueue() first.')
  }
  return eventQueue
}

export async function addEvent(eventType: string, data: any) {
  if (!usingMemoryQueue && eventQueue) {
    const job = await eventQueue.add(eventType, data, { removeOnComplete: true })
    return job.id
  } else {
    // In-memory queue: just store the event
    const id = `mem-${Date.now()}-${Math.random()}`
    memoryQueueEvents.push({ type: eventType, data })
    return id
  }
}

export function registerEventHandlers(handlers: Record<string, (data: any) => Promise<void>>) {
  if (!usingMemoryQueue && eventQueue) {
    // Use BullMQ worker
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
  } else {
    // Use in-memory queue processor
    console.log('📋 Using in-memory event queue')

    // Process queued events immediately
    memoryQueueWorker = setInterval(async () => {
      if (memoryQueueEvents.length > 0) {
        const event = memoryQueueEvents.shift()
        if (event) {
          const handler = handlers[event.type]
          if (handler) {
            try {
              await handler(event.data)
              console.log(`Event processed: ${event.type}`)
            } catch (err) {
              console.error(`Event failed: ${event.type}`, err)
            }
          } else {
            console.warn(`No handler for event: ${event.type}`)
          }
        }
      }
    }, 100)

    return { on: () => {} } // Return a dummy worker object
  }
}

export const eventHandlers: Record<string, () => Promise<void>> = {}

export function getEventHandlers() {
  return eventHandlers
}
