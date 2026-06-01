/**
 * cache/upstash.ts — Upstash Redis cache adapter (optional L2).
 *
 * Only activates when UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN
 * are set. Otherwise, the factory in index.ts falls back to memory cache.
 *
 * Uses the Upstash REST API directly (no npm dependency required)
 * to keep the bundle lean. Install @upstash/redis for a richer DX later.
 */

import type { CacheAdapter } from "./types"
import { logError, logInfo } from "@/lib/observability/logger"

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL ?? ""
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN ?? ""

async function upstashCommand(
  command: string[],
): Promise<unknown> {
  const res = await fetch(`${UPSTASH_URL}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Upstash error (${res.status}): ${text}`)
  }

  const data = (await res.json()) as { result: unknown }
  return data.result
}

export const upstashCache: CacheAdapter = {
  name: "upstash",

  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = (await upstashCommand(["GET", key])) as string | null
      if (raw === null) return null
      return JSON.parse(raw) as T
    } catch (err) {
      logError("cache.upstash.get_error", {
        key,
        error: err instanceof Error ? err.message : String(err),
      })
      return null
    }
  },

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    try {
      await upstashCommand(["SET", key, JSON.stringify(value), "EX", String(ttlSeconds)])
    } catch (err) {
      logError("cache.upstash.set_error", {
        key,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  },

  async incr(key: string, ttlSeconds: number): Promise<number> {
    try {
      const result = (await upstashCommand(["INCR", key])) as number
      if (result === 1) {
        await upstashCommand(["EXPIRE", key, String(ttlSeconds)])
      }
      return result
    } catch (err) {
      logError("cache.upstash.incr_error", {
        key,
        error: err instanceof Error ? err.message : String(err),
      })
      return 1
    }
  },

  async del(key: string): Promise<void> {
    try {
      await upstashCommand(["DEL", key])
    } catch (err) {
      logError("cache.upstash.del_error", {
        key,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  },

  async invalidatePrefix(prefix: string): Promise<void> {
    try {
      let cursor = "0"
      let deleted = 0
      do {
        const scanResult = (await upstashCommand([
          "SCAN", cursor, "MATCH", `${prefix}*`, "COUNT", "100"
        ])) as [string, string[]]
        
        cursor = scanResult[0]
        const keys = scanResult[1]
        
        if (keys && keys.length > 0) {
          await upstashCommand(["DEL", ...keys])
          deleted += keys.length
        }
      } while (cursor !== "0")
      
      if (deleted > 0) {
        logInfo("cache.upstash.invalidate", { prefix, deleted })
      }
    } catch (err) {
      logError("cache.upstash.invalidate_error", {
        prefix,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  },
}

/** Returns true if Upstash env vars are configured. */
export function isUpstashConfigured(): boolean {
  return Boolean(UPSTASH_URL && UPSTASH_TOKEN)
}
