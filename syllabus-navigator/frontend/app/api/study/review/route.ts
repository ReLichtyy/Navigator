/**
 * POST /api/study/review — record a flashcard review (Modo repaso / tarjetas).
 * Advances the Leitner box and feeds the study streak. Body: { syllabus_id,
 * card_key, known }. Ownership of the syllabus is enforced before recording.
 */
import { NextResponse } from "next/server"
import { requireAuth, ApiErrorResponse } from "@/lib/server/utils/auth-helpers"
import { FlashcardReviewSchema } from "@/lib/server/validators/api.schemas"
import { DocumentRepository } from "@/lib/server/repositories/document.repo"
import { StudyStatsRepository } from "@/lib/server/repositories/study-stats.repo"
import { logError } from "@/lib/observability/logger"

export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  try {
    const { userId } = await requireAuth()
    const parsed = FlashcardReviewSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }, { status: 400 })
    }
    const { syllabus_id, card_key, known } = parsed.data

    const doc = await DocumentRepository.findByIdAndUser(syllabus_id, userId)
    if (!doc) throw new ApiErrorResponse("Syllabus not found", 404)

    await StudyStatsRepository.recordReview(userId, syllabus_id, card_key, known)
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
