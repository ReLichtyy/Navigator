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

  if (!limiter) {
    // If Upstash isn't configured, allow by default but log it occasionally
    if (Math.random() < 0.05) {
      logInfo("rate_limit.bypassed_missing_redis", { identifier, tier })
    }
    return {
      success: true,
      limit: LIMITS[tier],
      remaining: 999,
      reset: Date.now() + 60000,
    }
  }

  try {
    const { success, limit, remaining, reset } = await limiter.limit(`rl_${tier}_${identifier}`)
    
    if (!success) {
      logInfo("rate_limit.exceeded", { identifier, tier, limit })
    }
    
    return { success, limit, remaining, reset }
  } catch (error) {
    // Fallback to allow if Redis call fails (e.g. network timeout)
    logError("rate_limit.check_failed", { error: String(error), identifier })
    return {
      success: true,
      limit: LIMITS[tier],
      remaining: 999,
      reset: Date.now() + 60000,
    }
  }
}
