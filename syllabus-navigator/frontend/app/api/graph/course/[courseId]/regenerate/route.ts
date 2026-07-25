/**
 * POST /api/graph/course/[courseId]/regenerate — (re)generate the whole-course
 * mind map from the selected documents (+ optional focus topics / instructions).
 * Synchronous: responds with the finished CourseGraphResponseAPI.
 */

import { NextResponse } from "next/server"
import { requireAuth, requireRateLimit, ApiErrorResponse } from "@/lib/server/utils/auth-helpers"
import { CourseGraphService } from "@/lib/server/services/course-graph.service"
import { CourseGraphRegenerateSchema } from "@/lib/server/validators/api.schemas"
import { logError } from "@/lib/observability/logger"

export const dynamic = "force-dynamic"
// Single LLM call over the combined course text — same budget as the
// whole-course study set (Fluid compute; drop to 60 if the plan rejects it).
export const maxDuration = 15

type RouteParams = { params: Promise<{ courseId: string }> }

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { userId, role } = await requireAuth()
    if (role === "guest") throw new ApiErrorResponse("Los cursos requieren una cuenta.", 403)
    await requireRateLimit(userId, role)
    const { courseId } = await params

    const parsed = CourseGraphRegenerateSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request" },
        { status: 400 },
      )
    }

    const run = await CourseGraphService.enqueueRegeneration(userId, courseId, parsed.data)
    return NextResponse.json(run, { status: 202 })
  } catch (err) {
    if (err instanceof ApiErrorResponse) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    logError("api.graph.course_regenerate_error", {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: "Failed to regenerate course graph." }, { status: 500 })
  }
}
