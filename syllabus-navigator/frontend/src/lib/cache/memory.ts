/**
 * cache/memory.ts — In-memory cache with TTL expiration.
 *
 * Uses a simple Map. On Vercel, the cache persists across warm invocations
 * of the same serverless instance (~15 min idle timeout) but resets on cold
 * starts. This is fine for L1 caching — Neon is always the source of truth.
 */

import type { CacheAdapter, CacheEntry } from "./types"
import { logInfo } from "@/lib/observability/logger"

const store = new Map<string, CacheEntry>()

// Periodic cleanup every 60s to prevent unbounded memory growth.
const CLEANUP_INTERVAL_MS = 60_000
let cleanupTimer: ReturnType<typeof setInterval> | null = null

function startCleanup() {
  if (cleanupTimer) return
  cleanupTimer = setInterval(() => {
    const now = Date.now()
    let removed = 0
    for (const [key, entry] of store) {
      if (entry.expiresAt <= now) {
        store.delete(key)
        removed++
      }
    }
    if (removed > 0) {
      logInfo("cache.cleanup", { adapter: "memory", removed, remaining: store.size })
    }
  }, CLEANUP_INTERVAL_MS)
  // Don't prevent Node from exiting.
  if (cleanupTimer && typeof cleanupTimer === "object" && "unref" in cleanupTimer) {
    cleanupTimer.unref()
  }
}

export const memoryCache: CacheAdapter = {
  name: "memory",

  async get<T>(key: string): Promise<T | null> {
    const entry = store.get(key)
    if (!entry) return null
    if (entry.expiresAt <= Date.now()) {
      store.delete(key)
      return null
    }
    return entry.value as T
  },

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    store.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    })
    startCleanup()
  },

  async del(key: string): Promise<void> {
    store.delete(key)
  },

  async invalidatePrefix(prefix: string): Promise<void> {
    for (const key of store.keys()) {
      if (key.startsWith(prefix)) {
        store.delete(key)
      }
    }
  },
}
