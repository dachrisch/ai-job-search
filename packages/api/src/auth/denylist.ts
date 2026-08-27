// In-memory JWT denylist for revoked tokens (logout, password change, delete).
// Tokens auto-expire with their JWT expiry (7d), so the denylist is bounded.
// Upgrade to Redis if horizontal scaling is needed.

const deniedTokens = new Map<string, number>() // token -> expiry timestamp (ms)

const CLEANUP_INTERVAL = 60 * 60 * 1000 // 1 hour
const TOKEN_MAX_AGE = 7 * 24 * 60 * 60 * 1000 // 7 days

export function addToken(token: string, expiresAtMs?: number): void {
  const expiry = expiresAtMs || Date.now() + TOKEN_MAX_AGE
  deniedTokens.set(token, expiry)
}

export function isDenied(token: string): boolean {
  const expiry = deniedTokens.get(token)
  if (!expiry) return false
  if (Date.now() > expiry) {
    deniedTokens.delete(token)
    return false
  }
  return true
}

// Periodic cleanup of expired entries — call on an interval.
export function cleanupDeniedTokens(): void {
  const now = Date.now()
  for (const [token, expiry] of deniedTokens) {
    if (now > expiry) deniedTokens.delete(token)
  }
}

// Start automatic cleanup. Safe to call multiple times (only one interval).
let cleanupTimer: ReturnType<typeof setInterval> | null = null
export function startDenylistCleanup(): void {
  if (cleanupTimer) return
  cleanupTimer = setInterval(cleanupDeniedTokens, CLEANUP_INTERVAL)
  // Allow the process to exit even if the timer is running.
  if (cleanupTimer.unref) cleanupTimer.unref()
}
