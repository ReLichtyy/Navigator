/**
 * GET    /api/chat/[chatId] — Get chat detail with messages.
 * PATCH  /api/chat/[chatId] — Update chat title/model/syllabus.
 * DELETE /api/chat/[chatId] — Delete a chat and its messages.
 */

import { NextResponse } from "next/server"
import { getAuthedUser } from "@/lib/server/utils/auth-helpers"
import { ChatRepository } from "@/lib/server/repositories/chat.repo"
import { DocumentRepository } from "@/lib/server/repositories/document.repo"
import { UpdateChatSchema } from "@/lib/server/validators/api.schemas"
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
    const detail = await ChatRepository.getDetailWithMessages(chatId, session.userId)
    if (!detail) {
      return NextResponse.json({ error: "Chat not found" }, { status: 404 })
    }

    return NextResponse.json({
      ...detail.chat,
      message_count: detail.messages.length,
      messages: detail.messages,
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

    const parsed = UpdateChatSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 })
    }
    const patch = parsed.data

    const existing = await ChatRepository.findByIdAndUser(chatId, userId)
    if (!existing) {
      return NextResponse.json({ error: "Chat not found" }, { status: 404 })
    }

    if (
      patch.title === undefined &&
      patch.active_model === undefined &&
      patch.syllabus_id === undefined
    ) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 })
    }

    // Binding the chat to a syllabus grounds retrieval on that document — it must
    // belong to the caller, or anyone could read another user's uploads via chat.
    if (patch.syllabus_id) {
      const doc = await DocumentRepository.findByIdAndUser(patch.syllabus_id, userId)
      if (!doc) {
        return NextResponse.json({ error: "Syllabus not found" }, { status: 404 })
      }
    }

    const updated = await ChatRepository.updateChat(chatId, userId, patch)
    if (!updated) {
      return NextResponse.json({ error: "Chat not found" }, { status: 404 })
    }

    if (patch.title !== undefined) {
      await invalidatePrefix(`chats:list:${userId}`)
    }

    return NextResponse.json(updated)
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
    const deleted = await ChatRepository.deleteChat(chatId, session.userId)
    if (!deleted) {
      return NextResponse.json({ error: "Chat not found" }, { status: 404 })
    }

    await invalidatePrefix(`chats:list:${session.userId}`)
    return new NextResponse(null, { status: 204 })
  } catch (err) {
    logError("api.chat.delete_error", {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: "Failed to delete chat." }, { status: 500 })
  }
}
