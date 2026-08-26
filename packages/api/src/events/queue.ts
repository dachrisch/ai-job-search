import { Queue, Worker } from 'bullmq'
import { SSEManager } from '../utils/SSEManager.js'
import { SearchSessionModel } from '../db/models.js'

const redisConnection = {
  url: process.env.REDIS_URL || 'redis://localhost:6379'
}

// How many events the BullMQ worker processes in parallel. The pipeline used to
// run with concurrency 1, which let a single slow/stuck search block every
// other search. A modest concurrency keeps the queue flowing without saturating
// the crawler/LLM services.
const WORKER_CONCURRENCY = Number(process.env.QUEUE_WORKER_CONCURRENCY || 5)

// Retry/backoff: transient failures (flaky crawler, opencode hiccup) should be
// retried, but only a bounded number of times before the job lands in the
// dead-letter queue so nothing is silently lost.
const DEFAULT_JOB_ATTEMPTS = Number(process.env.QUEUE_JOB_ATTEMPTS || 3)
const DEFAULT_BACKOFF = {
  type: 'exponential' as const,
  delay: 5000,
}

let eventQueue: Queue | null = null
let deadLetterQueue: Queue | null = null
let usingMemoryQueue = false
let memoryQueueEvents: Array<{ type: string; data: any; attempts: number }> = []
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
    try {
      deadLetterQueue = new Queue('job-search-events-dlq', { connection: redisConnection as any })
      await deadLetterQueue.waitUntilReady()
      console.log('   DLQ initialized')
    } catch (err: any) {
      console.warn(`   ⚠️  DLQ unavailable (failed jobs will only be logged): ${err.message}`)
      deadLetterQueue = null
    }
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
      const job = await eventQueue.add(eventType, data, {
        removeOnComplete: true,
        attempts: DEFAULT_JOB_ATTEMPTS,
        backoff: DEFAULT_BACKOFF,
      })
      console.log(`📤 Event queued: ${eventType} (Job ID: ${job.id})`)
      return job.id
    } catch (error: any) {
      console.error(`❌ Failed to queue event ${eventType}:`, error.message)
      throw error
    }
  } else {
    // In-memory queue: just store the event
    const id = `mem-${Date.now()}-${Math.random()}`
    memoryQueueEvents.push({ type: eventType, data, attempts: DEFAULT_JOB_ATTEMPTS })
    console.log(`📤 Event queued to memory: ${eventType} (ID: ${id})`)
    return id
  }
}

/**
 * Moves a permanently failed job to the dead-letter queue so it can be
 * inspected/requeued later instead of vanishing after retries are exhausted.
 */
async function moveToDeadLetter(job: any, err: Error): Promise<void> {
  try {
    if (!deadLetterQueue) return
    await deadLetterQueue.add(job.name, {
      ...job.data,
      dlq: { originalJobId: job.id, attemptedAt: new Date(), error: err.message },
    })
    console.error(`📥 Moved failed job to DLQ: ${job.name} (Job ID: ${job.id})`)
  } catch (dlqError: any) {
    console.error(`❌ Failed to move job to DLQ (${job.name}):`, dlqError.message)
  }
}

/**
 * When a pipeline job exhausts its retries, the search it belongs to must not
 * stay `running` forever — surface a stored failure reason and an SSE error.
 */
async function markSessionFailed(job: any, err: Error, sseManager: SSEManager | null): Promise<void> {
  const searchId = job?.data?.searchId
  if (!searchId) return
  const reason = `Pipeline job "${job.name}" failed: ${err.message}`
  try {
    const session = await SearchSessionModel.findById(searchId)
    if (session && session.status === 'running') {
      session.status = 'failed'
      session.failureReason = reason
      await session.save()
      console.error(`🚨 Marked session ${searchId} as failed after ${job.name} exhausted retries`)
      if (sseManager) {
        sseManager.broadcast(searchId, {
          type: 'error',
          payload: { message: reason, searchStatus: 'failed' },
        })
        sseManager.broadcast(searchId, {
          type: 'status',
          payload: { status: 'failed' },
        })
      }
    }
  } catch (dbErr) {
    console.error(`Failed to mark session ${searchId} failed after ${job.name}:`, dbErr)
  }
}

export function registerEventHandlers(handlers: Record<string, (data: any, sseManager: SSEManager) => Promise<void>>, sseManager: SSEManager) {
  if (!usingMemoryQueue && eventQueue) {
    // Use BullMQ worker with Redis
    console.log('🚀 Starting BullMQ worker for event processing...')

    const worker = new Worker('job-search-events', async (job) => {
      console.log(`\n⚙️  Processing event: ${job.name} (Job ID: ${job.id}, attempt ${job.attemptsMade + 1})`)
      const handler = handlers[job.name]
      if (handler) {
        try {
          await handler(job.data, sseManager)
          console.log(`✅ Event completed: ${job.name}`)
        } catch (error) {
          console.error(`❌ Handler error for ${job.name}:`, error)
          throw error // Re-throw so BullMQ marks job as failed and applies retry/backoff
        }
      } else {
        console.warn(`⚠️  No handler registered for event: ${job.name}`)
        throw new Error(`No handler for event type: ${job.name}`)
      }
    }, { connection: redisConnection as any, concurrency: WORKER_CONCURRENCY })

    worker.on('ready', () => {
      console.log('✅ BullMQ worker is ready and listening for jobs')
    })

    worker.on('completed', (job) => {
      console.log(`✅ Event processed successfully: ${job.name}`)
    })

    worker.on('failed', (job, err) => {
      const attempts = job?.attemptsMade ?? 0
      const maxAttempts = job?.opts?.attempts ?? DEFAULT_JOB_ATTEMPTS
      console.error(`❌ Event failed: ${job?.name} (attempt ${attempts}/${maxAttempts})`, err?.message)
      // Only dead-letter when retries are exhausted — transient failures get retried.
      if (job && attempts >= maxAttempts) {
        moveToDeadLetter(job, err)
        markSessionFailed(job, err, sseManager)
      }
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
            } catch (err: any) {
              event.attempts -= 1
              if (event.attempts > 0) {
                console.error(`Event retrying (${event.attempts} left): ${event.type}`, err?.message)
                memoryQueueEvents.push(event)
              } else {
                console.error(`Event failed permanently: ${event.type}`, err?.message)
              }
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
