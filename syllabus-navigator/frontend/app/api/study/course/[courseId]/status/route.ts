/**
 * GET /api/study/course/[courseId]/status — light whole-course study status:
 * bank item counts + whether the default set is cached. SQL only, never generates.
 */

import { NextResponse } from "next/server"
import { requireAuth, ApiErrorResponse } from "@/lib/server/utils/auth-helpers"
import { StudyService } from "@/lib/server/services/study.service"
import { logError } from "@/lib/observability/logger"

export const dynamic = "force-dynamic"

export async function GET(_req: Request, { params }: { params: Promise<{ courseId: string }> }) {
  try {
    const { userId, role } = await requireAuth()
    if (role === "guest") throw new ApiErrorResponse("Los cursos requieren una cuenta.", 403)
    const { courseId } = await params
    const data = await StudyService.getStudyStatus(userId, { kind: "course", id: courseId })
    return NextResponse.json(data)
  } catch (err) {
    if (err instanceof ApiErrorResponse) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    logError("api.study.course_status_error", {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: "Failed to load study status." }, { status: 500 })
  }
}
