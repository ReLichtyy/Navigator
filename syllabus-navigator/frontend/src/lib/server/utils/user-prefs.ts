/**
 * server/utils/user-prefs.ts — Shared, cached read of a user's preferences.
 *
 * Single source for services that consume preferences (chat persona, study
 * language, study defaults). Uses the SAME cache key as the
 * `/api/user/preferences` route (`user:prefs:<userId>`, TTL 120s), so a PATCH
 * there invalidates this read too. Never throws: on any DB error it returns
 * the defaults so no consumer (chat, study) breaks because of preferences.
 */

import { sql } from "@/lib/db"
import { cached } from "@/lib/cache"
import { logError } from "@/lib/observability/logger"
import type { UserProfileInput } from "../validators/api.schemas"

export type UserProfile = UserProfileInput

export interface UserPrefs {
  defaultProvider: string
  defaultModel: string
  theme: string
  language: string
  profile: UserProfile
}

export const USER_PREFS_TTL_SECONDS = 120

export const DEFAULT_PREFS: UserPrefs = {
  defaultProvider: "openai",
  defaultModel: "gpt-4o-mini",
  theme: "dark",
  language: "es",
  profile: {},
}

export function userPrefsCacheKey(userId: string): string {
  return `user:prefs:${userId}`
}

/** Cached (120s) preferences for a user; safe defaults when missing or on error. */
export async function getUserPrefs(userId: string): Promise<UserPrefs> {
  try {
    return await cached(userPrefsCacheKey(userId), USER_PREFS_TTL_SECONDS, async () => {
      const rows = await sql`
        SELECT default_provider, default_model, theme, language, profile
        FROM user_preferences
        WHERE user_id = ${userId}::uuid
      `
      const row = (rows as Record<string, unknown>[])[0]
      return {
        defaultProvider: (row?.default_provider as string) ?? DEFAULT_PREFS.defaultProvider,
        defaultModel: (row?.default_model as string) ?? DEFAULT_PREFS.defaultModel,
        theme: (row?.theme as string) ?? DEFAULT_PREFS.theme,
        language: (row?.language as string) ?? DEFAULT_PREFS.language,
        profile: (row?.profile as UserProfile) ?? {},
      }
    })
  } catch (err) {
    logError("user_prefs.read_error", { error: err instanceof Error ? err.message : String(err) })
    return DEFAULT_PREFS
  }
}
