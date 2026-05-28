import { Queue, Worker } from 'bullmq'
import { SSEManager } from '../utils/SSEManager.js'

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
    console.log(`📡 Attempting Redis connection to ${process.env.REDIS_URL}...`)
    const queue = new Queue('job-search-events', { connection: redisConnection as any })

    // Verify queue is connected
    await queue.waitUntilReady()
    console.log('✅ Redis queue initialized and verified')
    usingMemoryQueue = false
    return queue
  } catch (err: any) {
    console.error('❌ Redis connection failed:', err.message)
    console.error('   Falling back to in-memory queue (not recommended for production)')
    console.error('   REDIS_URL:', process.env.REDIS_URL)
    usingMemoryQueue = true
    return null
  }
}

export async function initializeQueue() {
  console.log('\n📦 Initializing event queue...')
  console.log(`   REDIS_URL: ${process.env.REDIS_URL || 'not set'}`)
  eventQueue = await createQueue()
  if (eventQueue) {
    console.log('✅ Queue initialized successfully (BullMQ with Redis)')
  } else {
    console.error('❌ Queue failed to initialize - Redis unavailable')
  }
}

export function getQueue() {
  if (!eventQueue && !usingMemoryQueue) {
    throw new Error('Queue not initialized. Call initializeQueue() first.')
  }
  return eventQueue
}

export async function addEvent(eventType: string, data: any) {
  if (!usingMemoryQueue && eventQueue) {
    try {
      const job = await eventQueue.add(eventType, data, { removeOnComplete: true })
      console.log(`📤 Event queued: ${eventType} (Job ID: ${job.id})`)
      return job.id
    } catch (error: any) {
      console.error(`❌ Failed to queue event ${eventType}:`, error.message)
      throw error
    }
  } else {
    // In-memory queue: just store the event
    const id = `mem-${Date.now()}-${Math.random()}`
    memoryQueueEvents.push({ type: eventType, data })
    console.log(`📤 Event queued to memory: ${eventType} (ID: ${id})`)
    return id
  }
}

export function registerEventHandlers(handlers: Record<string, (data: any, sseManager: SSEManager) => Promise<void>>, sseManager: SSEManager) {
  if (!usingMemoryQueue && eventQueue) {
    // Use BullMQ worker with Redis
    console.log('🚀 Starting BullMQ worker for event processing...')

    const worker = new Worker('job-search-events', async (job) => {
      console.log(`\n⚙️  Processing event: ${job.name} (Job ID: ${job.id})`)
      const handler = handlers[job.name]
      if (handler) {
        try {
          await handler(job.data, sseManager)
          console.log(`✅ Event completed: ${job.name}`)
        } catch (error) {
          console.error(`❌ Handler error for ${job.name}:`, error)
          throw error // Re-throw so BullMQ marks job as failed
        }
      } else {
        console.warn(`⚠️  No handler registered for event: ${job.name}`)
        throw new Error(`No handler for event type: ${job.name}`)
      }
    }, { connection: redisConnection as any })

    worker.on('ready', () => {
      console.log('✅ BullMQ worker is ready and listening for jobs')
    })

    worker.on('completed', (job) => {
      console.log(`✅ Event processed successfully: ${job.name}`)
    })

    worker.on('failed', (job, err) => {
      console.error(`❌ Event failed: ${job?.name}`, err?.message)
    })

    worker.on('error', (err) => {
      console.error('❌ Worker error:', err.message)
    })

    return worker
  } else {
    // Use in-memory queue processor - ONLY as fallback
    if (usingMemoryQueue) {
      console.warn('⚠️  WARNING: Using in-memory event queue (Redis unavailable)')
      console.warn('   Events will be LOST if the process restarts!')
    }
    console.log('📋 Using in-memory event queue')

    // Process queued events immediately
    memoryQueueWorker = setInterval(async () => {
      if (memoryQueueEvents.length > 0) {
        const event = memoryQueueEvents.shift()
        if (event) {
          const handler = handlers[event.type]
          if (handler) {
            try {
              await handler(event.data, sseManager)
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
