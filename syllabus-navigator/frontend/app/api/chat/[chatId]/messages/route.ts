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
    const stream = await ChatService.processMessageStream(chatId, userId, role, question)

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
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
