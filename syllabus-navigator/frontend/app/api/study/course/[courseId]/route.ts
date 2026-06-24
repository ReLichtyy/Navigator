/**
 * GET /api/study/course/[courseId] — whole-course study material (flashcards/
 * quiz/summary/mindmap) aggregated across every PDF in a course the caller owns.
 * `?refresh=1` regenerates and re-caches it. Mirrors /api/study/[syllabusId].
 */

import { NextResponse } from "next/server"
import { requireAuth, ApiErrorResponse } from "@/lib/server/utils/auth-helpers"
import { StudyService } from "@/lib/server/services/study.service"
import { logError } from "@/lib/observability/logger"

export const dynamic = "force-dynamic"

export async function GET(req: Request, { params }: { params: Promise<{ courseId: string }> }) {
  try {
    const { userId, role } = await requireAuth()
    if (role === "guest") throw new ApiErrorResponse("Los cursos requieren una cuenta.", 403)
    const { courseId } = await params
    const sp = new URL(req.url).searchParams
    const refresh = sp.get("refresh") === "1"
    const d = sp.get("difficulty")
    const difficulty = d === "facil" || d === "medio" || d === "dificil" ? d : undefined
    const topic = sp.get("topic")?.slice(0, 160) || undefined

    const data = await StudyService.getCourseStudySet(userId, courseId, {
      refresh,
      difficulty,
      topic,
    })
    return NextResponse.json({ course_id: courseId, ...data })
  } catch (err) {
    if (err instanceof ApiErrorResponse) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    logError("api.study.course_get_error", {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: "Failed to load study material." }, { status: 500 })
  }
}
