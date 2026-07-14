/**
 * POST /api/study/review — record a flashcard review (Modo repaso / tarjetas).
 * Advances the Leitner box and feeds the study streak. Body: { kind, id, card_key,
 * known } — a study scope, so whole-course flashcards count too. The service
 * enforces ownership.
 */
import { NextResponse } from "next/server"
import { requireAuth, ApiErrorResponse } from "@/lib/server/utils/auth-helpers"
import { FlashcardReviewSchema } from "@/lib/server/validators/api.schemas"
import { StudyService } from "@/lib/server/services/study.service"
import { logError } from "@/lib/observability/logger"

export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  try {
    const { userId } = await requireAuth()
    const parsed = FlashcardReviewSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid body" },
        { status: 400 },
      )
    }
    const { kind, id, card_key, known } = parsed.data

    await StudyService.recordReview(userId, { kind, id }, card_key, known)
    return NextResponse.json({ success: true })
  } catch (err) {
    if (err instanceof ApiErrorResponse) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    logError("api.study.review_error", {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: "Failed to record review." }, { status: 500 })
  }
}
