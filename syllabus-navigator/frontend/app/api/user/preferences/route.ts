/**
 * GET   /api/user/preferences — Get user preferences.
 * PATCH /api/user/preferences — Update user preferences.
 */

import { NextResponse } from "next/server"
import { getAuthedUser } from "@/lib/server/utils/auth-helpers"
import { UpdatePreferencesSchema } from "@/lib/server/validators/api.schemas"
import { sql } from "@/lib/db"
import { cached, invalidate } from "@/lib/cache"
import { logError } from "@/lib/observability/logger"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const session = await getAuthedUser()
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const userId = session.userId

    const prefs = await cached(`user:prefs:${userId}`, 120, async () => {
      const rows = await sql`
        SELECT default_provider, default_model, theme, language
        FROM user_preferences
        WHERE user_id = ${userId}::uuid
      `
      const row = (rows as Record<string, unknown>[])[0]
      return {
        defaultProvider: row?.default_provider ?? "openai",
        defaultModel: row?.default_model ?? "gpt-4o-mini",
        theme: row?.theme ?? "dark",
        language: row?.language ?? "es",
      }
    })

    return NextResponse.json({ preferences: prefs })
  } catch (err) {
    logError("api.user.prefs.get_error", {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: "Failed to load preferences." }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await getAuthedUser()
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const userId = session.userId
    const body = await request.json().catch(() => null)

    const parsed = UpdatePreferencesSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "No valid fields to update." },
        { status: 400 },
      )
    }
    const updates = parsed.data

    // Upsert preferences
    const rows = await sql`
      INSERT INTO user_preferences (user_id, default_provider, default_model, theme, language)
      VALUES (
        ${userId}::uuid,
        ${updates.defaultProvider ?? "openai"},
        ${updates.defaultModel ?? "gpt-4o-mini"},
        ${updates.theme ?? "dark"},
        ${updates.language ?? "es"}
      )
      ON CONFLICT (user_id) DO UPDATE SET
        default_provider = COALESCE(${updates.defaultProvider ?? null}, user_preferences.default_provider),
        default_model = COALESCE(${updates.defaultModel ?? null}, user_preferences.default_model),
        theme = COALESCE(${updates.theme ?? null}, user_preferences.theme),
        language = COALESCE(${updates.language ?? null}, user_preferences.language),
        updated_at = now()
      RETURNING default_provider, default_model, theme, language
    `

    await invalidate(`user:prefs:${userId}`)

    const row = (rows as Record<string, unknown>[])[0]
    return NextResponse.json({
      preferences: {
        defaultProvider: row?.default_provider ?? "openai",
        defaultModel: row?.default_model ?? "gpt-4o-mini",
        theme: row?.theme ?? "dark",
        language: row?.language ?? "es",
      },
    })
  } catch (err) {
    logError("api.user.prefs.patch_error", {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: "Failed to update preferences." }, { status: 500 })
  }
}
