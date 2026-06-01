/**
 * GET  /api/chat/history — List all chats for the authenticated user.
 * POST /api/chat/history — Create a new chat.
 */

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/config"
import { sql } from "@/lib/db"
import { cached, invalidatePrefix } from "@/lib/cache"
import { logError } from "@/lib/observability/logger"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const userId = session.user.id

    const chats = await cached(`chats:list:${userId}`, 30, async () => {
      const rows = await sql`
        SELECT
          c.id, c.title, c.active_model, c.syllabus_id,
          c.created_at,
          COUNT(m.id)::int AS message_count
        FROM chats c
        LEFT JOIN messages m ON m.chat_id = c.id
        WHERE c.user_id = ${userId}
        GROUP BY c.id
        ORDER BY c.created_at DESC
      `
      return rows
    })

    return NextResponse.json({ chats })
  } catch (err) {
    logError("api.chat.history.list_error", {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: "Failed to load chats." }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const userId = session.user.id
    const body = await request.json().catch(() => ({}))
    const syllabusId = body.syllabus_id || null

    const rows = await sql`
      INSERT INTO chats (user_id, title, active_model, syllabus_id)
      VALUES (
        ${userId},
        'New chat',
        'gpt-4o-mini',
        ${syllabusId}::uuid
      )
      RETURNING id, title, active_model, syllabus_id, created_at
    `

    const chat = (rows as Record<string, unknown>[])[0]

    // Invalidate chat list cache
    await invalidatePrefix(`chats:list:${userId}`)

    return NextResponse.json(
      { ...chat, message_count: 0 },
      { status: 201 },
    )
  } catch (err) {
    logError("api.chat.history.create_error", {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: "Failed to create chat." }, { status: 500 })
  }
}
