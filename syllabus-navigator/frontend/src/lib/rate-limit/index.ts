/**
 * rate-limit/index.ts — Token bucket rate limiter.
 *
 * Uses the cache layer (L1 memory or L2 Upstash) to track request counts
 * per user within a sliding window.
 *
 * Integrated into middleware.ts — runs before route handlers.
 * Returns 429 Too Many Requests with Retry-After header when exceeded.
 */

import { getCache } from "@/lib/cache"
import { logWarn } from "@/lib/observability/logger"

// ── Rate limit tiers ─────────────────────────────────────────────────────────

export type RateLimitTier = "guest" | "free" | "pro" | "admin"

export interface RateLimitConfig {
  maxRequests: number
  windowMs: number
}

export const RATE_LIMITS: Record<RateLimitTier, RateLimitConfig> = {
  guest: { maxRequests: 5, windowMs: 60_000 },    // 5 req/min
  free: { maxRequests: 20, windowMs: 60_000 },   // 20 req/min
  pro: { maxRequests: 60, windowMs: 60_000 },   // 60 req/min
  admin: { maxRequests: 200, windowMs: 60_000 },   // 200 req/min
}

// ── Result ───────────────────────────────────────────────────────────────────

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  total: number
  resetAt: number        // Unix ms
  retryAfterMs?: number
}

// ── Check ────────────────────────────────────────────────────────────────────

/**
 * Check and increment the request counter for a user.
 *
 * @param userId   Unique user identifier (from session)
 * @param tier     User tier determines limits
 * @returns        Whether the request is allowed + metadata
 */
export async function checkRateLimit(
  userId: string,
  tier: RateLimitTier = "free",
): Promise<RateLimitResult> {
  const config = RATE_LIMITS[tier] ?? RATE_LIMITS.free
  const cache = getCache()
  const key = `ratelimit:${userId}`

  const windowSeconds = Math.ceil(config.windowMs / 1000)

  // Get current count
  const currentStr = await cache.get<string>(key)
  const current = currentStr ? parseInt(String(currentStr), 10) : 0

  const resetAt = Date.now() + config.windowMs

  if (current >= config.maxRequests) {
    const retryAfterMs = config.windowMs // worst case: full window
    logWarn("ratelimit.exceeded", {
      userId,
      tier,
      current,
      max: config.maxRequests,
      retryAfterMs,
    })
    return {
      allowed: false,
      remaining: 0,
      total: config.maxRequests,
      resetAt,
      retryAfterMs,
    }
  }

  // Increment
  await cache.set(key, current + 1, windowSeconds)

  return {
    allowed: true,
    remaining: config.maxRequests - current - 1,
    total: config.maxRequests,
    resetAt,
  }
}

/**
 * Check if rate limiting is enabled via environment.
 */
export function isRateLimitEnabled(): boolean {
  return process.env.RATE_LIMIT_ENABLED !== "false"
}
