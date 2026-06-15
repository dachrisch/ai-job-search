import {RateLimiter} from '../rate-limiter'

describe('RateLimiter', () => {
    it('should limit concurrent requests', async () => {
        const limiter = new RateLimiter({maxConcurrent: 2, delayMs: 10})
        const results: number[] = []

        const task = (n: number) =>
            limiter.execute(() => {
                results.push(n)
                return Promise.resolve(n)
            })

        await Promise.all([
            task(1),
            task(2),
            task(3),
            task(4)
        ])

        expect(results.length).toBe(4)
    })

    it('should respect minimum delay between requests', async () => {
        vi.useFakeTimers() // or jest.useFakeTimers()
        const limiter = new RateLimiter({maxConcurrent: 1, delayMs: 50})
        const times: number[] = []
        const task = () =>
            limiter.execute(() => {
                times.push(Date.now())
                return Promise.resolve()
            })

        const p1 = task()
        await vi.runAllTimersAsync()
        const p2 = task()
        await vi.runAllTimersAsync()
        await Promise.all([p1, p2])

        expect(times[1] - times[0]).toBeGreaterThanOrEqual(50)
        vi.useRealTimers()
    })
})
