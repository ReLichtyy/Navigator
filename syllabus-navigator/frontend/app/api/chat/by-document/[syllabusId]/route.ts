/**
 * POST /api/chat/by-document/[syllabusId] — find or create a chat for a document.
 *
 * Looks for an existing chat bound to this syllabus for the current user.
 * If found, returns it; otherwise creates a new one with the syllabus linked.
 */

import { NextResponse } from "next/server"
import { requireAuth, ApiErrorResponse } from "@/lib/server/utils/auth-helpers"
import { ChatRepository } from "@/lib/server/repositories/chat.repo"
import { DocumentRepository } from "@/lib/server/repositories/document.repo"
import { invalidatePrefix } from "@/lib/cache"
import { logInfo } from "@/lib/observability/logger"

export const dynamic = "force-dynamic"

type RouteParams = { params: Promise<{ syllabusId: string }> }

export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const { userId } = await requireAuth()
    const { syllabusId } = await params

    // Verify the document belongs to this user.
    const doc = await DocumentRepository.findByIdAndUser(syllabusId, userId)
    if (!doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 })
    }

    // Try to find an existing chat for this document.
    const existing = await ChatRepository.findByUserAndSyllabus(userId, syllabusId)
    if (existing) {
      logInfo("api.chat.by-document.found", { userId, syllabusId, chatId: existing.id })
      return NextResponse.json({
        ...existing,
        syllabus_name: doc.original_filename,
        message_count: 0, // not critical for navigation; UI refreshes
      })
    }

    // Create a new chat bound to this document.
    const chat = await ChatRepository.createChat(userId, syllabusId, null)
    await invalidatePrefix(`chats:list:${userId}`)

    logInfo("api.chat.by-document.created", { userId, syllabusId, chatId: (chat as any).id })
    return NextResponse.json({
      ...(chat as any),
      syllabus_name: doc.original_filename,
      message_count: 0,
    })
  } catch (err) {
    if (err instanceof ApiErrorResponse) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return NextResponse.json({ error: "Failed to find or create chat." }, { status: 500 })
  }
}
