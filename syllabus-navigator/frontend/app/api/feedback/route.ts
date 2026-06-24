/**
 * POST /api/feedback — Submit feedback on an AI response.
 * P1 stub: saves to DB, UI integration comes later.
 */

import { NextResponse } from "next/server"
import { getAuthedUser } from "@/lib/server/utils/auth-helpers"
import { sql } from "@/lib/db"
import { logError, logInfo } from "@/lib/observability/logger"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  try {
    const session = await getAuthedUser()
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json().catch(() => null)
    if (!body?.message_id || body?.rating === undefined) {
      return NextResponse.json({ error: "message_id and rating are required." }, { status: 400 })
    }

    const rating = Number(body.rating)
    if (rating !== 1 && rating !== -1) {
      return NextResponse.json({ error: "Rating must be 1 (good) or -1 (bad)." }, { status: 400 })
    }

    await sql`
      INSERT INTO feedback (user_id, message_id, rating, comment, prompt_id, model)
      VALUES (
        ${session.userId}::uuid,
        ${body.message_id}::uuid,
        ${rating},
        ${body.comment ?? null},
        ${body.prompt_id ?? null},
        ${body.model ?? null}
      )
    `

    logInfo("feedback.submitted", {
      userId: session.userId,
      messageId: body.message_id,
      rating,
    })

    return NextResponse.json({ success: true }, { status: 201 })
  } catch (err) {
    logError("api.feedback.error", {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: "Failed to save feedback." }, { status: 500 })
  }
}
