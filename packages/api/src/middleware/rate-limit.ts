import rateLimit from 'express-rate-limit'

// Skip the *global* limiter in tests so suites that exercise many endpoints
// don't trip it and become flaky. The auth limiters stay active in tests so
// their enforcement can be verified (and so a regression there is caught).
const skipGlobalInTest = (req: any, res: any) =>
  process.env.NODE_ENV === 'test' || process.env.VITEST === 'true'

// Global ceiling: protects the BullMQ worker (concurrency 5) and the rest of
// the API from a single client enqueuing unbounded work (audit finding E3).
export const globalRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipGlobalInTest,
  message: { error: 'Too many requests, please try again later' },
})

// Registration is particularly sensitive — an attacker could otherwise spin up
// unlimited accounts. Kept very tight (audit finding E1/E3).
export const registerRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many registration attempts, please try again later' },
})

export const loginRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again later' },
})
