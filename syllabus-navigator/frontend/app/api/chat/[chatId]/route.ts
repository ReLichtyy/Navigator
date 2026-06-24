/**
 * GET    /api/chat/[chatId] — Get chat detail with messages.
 * PATCH  /api/chat/[chatId] — Update chat title/model/syllabus.
 * DELETE /api/chat/[chatId] — Delete a chat and its messages.
 */

import { NextResponse } from "next/server"
import { getAuthedUser } from "@/lib/server/utils/auth-helpers"
import { sql } from "@/lib/db"
import { invalidatePrefix } from "@/lib/cache"
import { logError } from "@/lib/observability/logger"

export const dynamic = "force-dynamic"

type RouteParams = { params: Promise<{ chatId: string }> }

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const session = await getAuthedUser()
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { chatId } = await params
    const userId = session.userId

    // Fetch chat
    const chatRows = await sql`
      SELECT id, title, active_model, syllabus_id, created_at
      FROM chats
      WHERE id = ${chatId}::uuid AND user_id = ${userId}
    `
    const chat = (chatRows as Record<string, unknown>[])[0]
    if (!chat) {
      return NextResponse.json({ error: "Chat not found" }, { status: 404 })
    }

    // Fetch messages
    const messages = await sql`
      SELECT id, role, content, citations, created_at
      FROM messages
      WHERE chat_id = ${chatId}::uuid
      ORDER BY created_at ASC
    `

    return NextResponse.json({
      ...chat,
      message_count: (messages as unknown[]).length,
      messages,
    })
  } catch (err) {
    logError("api.chat.get_error", {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: "Failed to load chat." }, { status: 500 })
  }
}

export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const session = await getAuthedUser()
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { chatId } = await params
    const userId = session.userId
    const body = await request.json()

    // Verify ownership
    const existing = await sql`
      SELECT id FROM chats WHERE id = ${chatId}::uuid AND user_id = ${userId}
    `
    if ((existing as unknown[]).length === 0) {
      return NextResponse.json({ error: "Chat not found" }, { status: 404 })
    }

    // Build update fields
    const updates: string[] = []
    const values: unknown[] = []

    if (body.title !== undefined) {
      const rows = await sql`
        UPDATE chats SET title = ${body.title} WHERE id = ${chatId}::uuid AND user_id = ${userId}
        RETURNING id, title, active_model, syllabus_id, created_at
      `
      await invalidatePrefix(`chats:list:${userId}`)
      return NextResponse.json((rows as Record<string, unknown>[])[0])
    }

    if (body.active_model !== undefined) {
      const rows = await sql`
        UPDATE chats SET active_model = ${body.active_model} WHERE id = ${chatId}::uuid AND user_id = ${userId}
        RETURNING id, title, active_model, syllabus_id, created_at
      `
      return NextResponse.json((rows as Record<string, unknown>[])[0])
    }

    if (body.syllabus_id !== undefined) {
      const syllabusId = body.syllabus_id || null
      const rows = await sql`
        UPDATE chats SET syllabus_id = ${syllabusId}::uuid WHERE id = ${chatId}::uuid AND user_id = ${userId}
        RETURNING id, title, active_model, syllabus_id, created_at
      `
      return NextResponse.json((rows as Record<string, unknown>[])[0])
    }

    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 })
  } catch (err) {
    logError("api.chat.patch_error", {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: "Failed to update chat." }, { status: 500 })
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const session = await getAuthedUser()
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { chatId } = await params
    const userId = session.userId

    // Delete the chat scoped to its owner. messages.chat_id has ON DELETE CASCADE,
    // so the rows are removed automatically — and we never touch another user's data.
    const deleted = await sql`
      DELETE FROM chats WHERE id = ${chatId}::uuid AND user_id = ${userId}
      RETURNING id
    `
    if ((deleted as unknown[]).length === 0) {
      return NextResponse.json({ error: "Chat not found" }, { status: 404 })
    }

    await invalidatePrefix(`chats:list:${userId}`)

    return new NextResponse(null, { status: 204 })
  } catch (err) {
    logError("api.chat.delete_error", {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: "Failed to delete chat." }, { status: 500 })
  }
}
