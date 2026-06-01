/**
 * cache/types.ts — Abstract cache adapter interface.
 *
 * Both in-memory and Upstash Redis adapters implement this interface,
 * allowing seamless swapping between development and production.
 */

export interface CacheEntry<T = unknown> {
  value: T
  expiresAt: number  // Unix timestamp in ms
}

export interface CacheAdapter {
  /** Retrieve a cached value. Returns null on miss or expiration. */
  get<T>(key: string): Promise<T | null>

  /** Store a value with a TTL in seconds. */
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>

  /** Delete a specific key. */
  del(key: string): Promise<void>

  /** Delete all keys matching a prefix (e.g. "chats:list:*"). */
  invalidatePrefix(prefix: string): Promise<void>

  /** Return the adapter name for observability. */
  readonly name: string
}
