interface RateLimiterConfig {
  maxConcurrent: number
  delayMs: number
}

export class RateLimiter {
  private config: RateLimiterConfig
  private activeRequests = 0
  private queue: Array<() => void> = []
  private lastRequestTime = 0

  constructor(config: RateLimiterConfig) {
    this.config = config
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    while (this.activeRequests >= this.config.maxConcurrent) {
      await new Promise(resolve => this.queue.push(resolve))
    }

    const now = Date.now()
    const timeSinceLastRequest = now - this.lastRequestTime
    if (timeSinceLastRequest < this.config.delayMs) {
      await new Promise(resolve =>
        setTimeout(resolve, this.config.delayMs - timeSinceLastRequest)
      )
    }

    this.activeRequests++
    this.lastRequestTime = Date.now()

    try {
      return await fn()
    } finally {
      this.activeRequests--
      const resolve = this.queue.shift()
      if (resolve) resolve()
    }
  }
}
