import { NextResponse } from "next/server"
import { requireAuth, requireRateLimit, ApiErrorResponse } from "@/lib/server/utils/auth-helpers"
import { MessageRequestSchema } from "@/lib/server/validators/api.schemas"
import { ChatService } from "@/lib/server/services/chat.service"
import { logError, logInfo } from "@/lib/observability/logger"

export const dynamic = "force-dynamic"

type RouteParams = { params: Promise<{ chatId: string }> }

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { userId, role } = await requireAuth()
    const { chatId } = await params
    
    // Parse and validate request
    const body = await request.json().catch(() => null)
    const parsedBody = MessageRequestSchema.safeParse(body)
    if (!parsedBody.success) {
      return NextResponse.json({ answer: null, error: parsedBody.error.issues[0].message }, { status: 400 })
    }

    const { question } = parsedBody.data

    await requireRateLimit(userId, role)

    // Process via Service
    const result = await ChatService.processMessage(chatId, userId, role, question)

    logInfo("api.chat.message.success", {
      chatId,
      provider: result.provider,
      model: result.model,
      latencyMs: result.latencyMs,
    })

    return NextResponse.json({
      chat_id: chatId,
      answer: result.finalAnswer,
      citations: [], // TODO: RAG citations
      title: result.title,
      provider: result.provider,
      model: result.model,
      error: null,
    })

  } catch (err) {
    if (err instanceof ApiErrorResponse) {
      return NextResponse.json({ answer: null, error: err.message }, { status: err.status })
    }
    
    logError("api.chat.message.error", {
      error: err instanceof Error ? err.message : String(err),
    })
    
    return NextResponse.json(
      { answer: null, error: "Failed to process message." },
      { status: 500 }
    )
  }
}
