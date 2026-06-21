import { Ratelimit } from "@upstash/ratelimit"
import { Redis } from "@upstash/redis"
import { logError, logInfo } from "./observability/logger"

// Define limits (requests per minute)
const LIMITS = {
  anonymous: 5,
  guest: 10,
  authenticated: 100,
}

let redisClient: Redis | null = null

if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  try {
    redisClient = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    })
  } catch (error) {
    logError("rate_limit.redis_init_error", { error: String(error) })
  }
}

// Map of instantiated limiters per role
const limiters = {
  anonymous: redisClient
    ? new Ratelimit({
        redis: redisClient,
        limiter: Ratelimit.slidingWindow(LIMITS.anonymous, "1 m"),
        analytics: true,
      })
    : null,
  guest: redisClient
    ? new Ratelimit({
        redis: redisClient,
        limiter: Ratelimit.slidingWindow(LIMITS.guest, "1 m"),
        analytics: true,
      })
    : null,
  authenticated: redisClient
    ? new Ratelimit({
        redis: redisClient,
        limiter: Ratelimit.slidingWindow(LIMITS.authenticated, "1 m"),
        analytics: true,
      })
    : null,
}

// ---- In-memory fallback (no Upstash) ----------------------------------------
// Best-effort sliding window kept in process memory. On Vercel this is per-instance
// and resets on cold start, so it won't catch a distributed flood — but it does stop
// a burst hammering one warm instance, which is strictly better than allow-all.
const WINDOW_MS = 60_000
const memoryHits = new Map<string, number[]>()

function inMemoryLimit(key: string, limit: number): RateLimitResult {
  const now = Date.now()
  const cutoff = now - WINDOW_MS
  const hits = (memoryHits.get(key) ?? []).filter((t) => t > cutoff)

  const success = hits.length < limit
  if (success) hits.push(now)
  memoryHits.set(key, hits)

  // Opportunistic cleanup so the map can't grow unbounded across many identifiers.
  if (memoryHits.size > 5000) {
    for (const [k, v] of memoryHits) {
      const live = v.filter((t) => t > cutoff)
      if (live.length === 0) memoryHits.delete(k)
      else memoryHits.set(k, live)
    }
  }

  const oldest = hits[0] ?? now
  return {
    success,
    limit,
    remaining: Math.max(0, limit - hits.length),
    reset: oldest + WINDOW_MS,
  }
}

export type RateLimitTier = "anonymous" | "guest" | "authenticated"

export interface RateLimitResult {
  success: boolean
  limit: number
  remaining: number
  reset: number
}

/**
 * Checks if a request is allowed based on the user's tier.
 * Gracefully falls back to ALLOW if Redis is not configured.
 */
export async function checkRateLimit(
  identifier: string,
  tier: RateLimitTier
): Promise<RateLimitResult> {
  const limiter = limiters[tier]
  const key = `rl_${tier}_${identifier}`

  if (!limiter) {
    // No Upstash → use the in-memory fallback instead of allowing everything.
    if (Math.random() < 0.05) {
      logInfo("rate_limit.using_memory_fallback", { identifier, tier })
    }
    return inMemoryLimit(key, LIMITS[tier])
  }

  try {
    const { success, limit, remaining, reset } = await limiter.limit(key)

    if (!success) {
      logInfo("rate_limit.exceeded", { identifier, tier, limit })
    }

    return { success, limit, remaining, reset }
  } catch (error) {
    // Redis call failed (e.g. network timeout) → degrade to in-memory, not allow-all.
    logError("rate_limit.check_failed", { error: String(error), identifier })
    return inMemoryLimit(key, LIMITS[tier])
  }
}
