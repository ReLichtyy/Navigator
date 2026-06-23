/**
 * GET /api/study/[syllabusId] — study material (flashcards/quiz/summary/mindmap)
 * for a syllabus the caller owns. `?refresh=1` regenerates and re-caches it.
 */

import { NextResponse } from "next/server"
import { requireAuth, ApiErrorResponse } from "@/lib/server/utils/auth-helpers"
import { StudyService } from "@/lib/server/services/study.service"
import { logError } from "@/lib/observability/logger"

export const dynamic = "force-dynamic"

export async function GET(
  req: Request,
  { params }: { params: Promise<{ syllabusId: string }> },
) {
  try {
    const { userId } = await requireAuth()
    const { syllabusId } = await params
    const refresh = new URL(req.url).searchParams.get("refresh") === "1"

    const data = await StudyService.getStudySet(userId, syllabusId, { refresh })
    return NextResponse.json({ syllabus_id: syllabusId, ...data })
  } catch (err) {
    if (err instanceof ApiErrorResponse) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    logError("api.study.get_error", {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: "Failed to load study material." }, { status: 500 })
  }
}
