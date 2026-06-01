/**
 * cache/index.ts — Cache factory + read-through helpers.
 *
 * Returns the best available adapter:
 *   - Upstash Redis if configured (distributed L2)
 *   - In-memory Map otherwise (per-instance L1)
 *
 * Neon Postgres is always the source of truth.
 */

import type { CacheAdapter } from "./types"
import { memoryCache } from "./memory"
import { upstashCache, isUpstashConfigured } from "./upstash"
import { logInfo } from "@/lib/observability/logger"

let _adapter: CacheAdapter | null = null

/**
 * Get the singleton cache adapter.
 */
export function getCache(): CacheAdapter {
  if (!_adapter) {
    _adapter = isUpstashConfigured() ? upstashCache : memoryCache
    logInfo("cache.init", { adapter: _adapter.name })
  }
  return _adapter
}

/**
 * Read-through cache helper.
 *
 * 1. Try cache → return on hit.
 * 2. On miss → call `fetcher` → store in cache → return.
 *
 * @example
 * const models = await cached("models:list", 300, () => fetchModelsFromConfig())
 */
export async function cached<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const cache = getCache()
  const hit = await cache.get<T>(key)
  if (hit !== null) {
    logInfo("cache.hit", { key, adapter: cache.name })
    return hit
  }

  logInfo("cache.miss", { key, adapter: cache.name })
  const value = await fetcher()
  await cache.set(key, value, ttlSeconds)
  return value
}

/**
 * Invalidate a single key.
 */
export async function invalidate(key: string): Promise<void> {
  await getCache().del(key)
}

/**
 * Invalidate all keys under a prefix.
 */
export async function invalidatePrefix(prefix: string): Promise<void> {
  await getCache().invalidatePrefix(prefix)
}

// Re-export types for convenience
export type { CacheAdapter, CacheEntry } from "./types"
