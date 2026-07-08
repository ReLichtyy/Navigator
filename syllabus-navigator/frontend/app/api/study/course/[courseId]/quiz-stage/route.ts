/**
 * GET /api/study/course/[courseId]/quiz-stage?stage=N&boost=B&exclude=id,id
 * One escalating stage of the staged quiz aggregated across a whole course the
 * caller owns. Mirrors /api/study/[syllabusId]/quiz-stage. Accounts only.
 */

import { NextResponse } from "next/server"
import { requireAuth, ApiErrorResponse } from "@/lib/server/utils/auth-helpers"
import { StudyService } from "@/lib/server/services/study.service"
import { logError } from "@/lib/observability/logger"

export const dynamic = "force-dynamic"
// Cold path generates via LLM agents before responding — see study/[syllabusId]
// for the timeout rationale. 300s needs Fluid compute (default on Vercel).
export const maxDuration = 300

export async function GET(req: Request, { params }: { params: Promise<{ courseId: string }> }) {
  try {
    const { userId, role } = await requireAuth()
    if (role === "guest") throw new ApiErrorResponse("Los cursos requieren una cuenta.", 403)
    const { courseId } = await params
    const sp = new URL(req.url).searchParams
    const stage = Number(sp.get("stage") ?? 0)
    const boost = Number(sp.get("boost") ?? 0)
    const excludeIds = (sp.get("exclude") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)

    const data = await StudyService.getCourseQuizStage(userId, courseId, {
      stage,
      boost,
      excludeIds,
    })
    return NextResponse.json(data)
  } catch (err) {
    if (err instanceof ApiErrorResponse) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    logError("api.study.course_quiz_stage_error", {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: "Failed to load quiz stage." }, { status: 500 })
  }
}
