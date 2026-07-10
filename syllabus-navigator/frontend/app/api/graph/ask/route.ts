/**
 * POST /api/graph/ask — inline grounded answer for the mind-map question bar.
 * Body: { question?, courseId?, syllabusId?, refine?, previousAnswer?, lang? }.
 * Returns { answer }. Retrieval is scoped to the course (or the single doc).
 */

import { NextResponse } from "next/server"
import { requireAuth, requireRateLimit, ApiErrorResponse } from "@/lib/server/utils/auth-helpers"
import { GraphAskService } from "@/lib/server/services/graph-ask.service"
import { GraphAskSchema } from "@/lib/server/validators/api.schemas"
import { logError } from "@/lib/observability/logger"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  try {
    const { userId, role } = await requireAuth()
    if (role === "guest") throw new ApiErrorResponse("El mapa mental requiere una cuenta.", 403)
    await requireRateLimit(userId, role)

    const parsed = GraphAskSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Solicitud inválida" },
        { status: 400 },
      )
    }

    const answer = await GraphAskService.ask({
      userId,
      courseId: parsed.data.courseId,
      syllabusId: parsed.data.syllabusId,
      question: parsed.data.question ?? "",
      refine: parsed.data.refine,
      previousAnswer: parsed.data.previousAnswer,
      lang: parsed.data.lang,
    })
    return NextResponse.json(answer)
  } catch (err) {
    if (err instanceof ApiErrorResponse) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    logError("api.graph.ask_error", {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: "No se pudo responder la pregunta." }, { status: 500 })
  }
}
