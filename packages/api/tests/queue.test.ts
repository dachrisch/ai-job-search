import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getQueue, addEvent, getEventHandlers } from '../src/events/queue'

describe.skip('Event Queue', () => {
  beforeEach(async () => {
    const queue = getQueue()
    await queue.clean(0, 1000)
  })

  afterEach(async () => {
    const queue = getQueue()
    await queue.close()
  })

  it('should add event to queue', async () => {
    const queue = getQueue()
    const jobId = await addEvent('search_started', { searchId: '123', userId: 'user1' })
    expect(jobId).toBeDefined()
  })

  it('should have event handlers registered', () => {
    const handlers = getEventHandlers()
    expect(handlers.search_started).toBeDefined()
    expect(handlers.sites_identified).toBeDefined()
    expect(handlers.jobs_scraped).toBeDefined()
  })
})
