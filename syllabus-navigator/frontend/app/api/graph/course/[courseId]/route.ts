/**
 * GET  /api/graph/course/[courseId]  — whole-course mind map (CourseGraphResponseAPI).
 * PATCH /api/graph/course/[courseId] — save a user-edited course map.
 * 404 if the course doesn't exist or isn't the caller's.
 */

import { NextResponse } from "next/server"
import { requireAuth, ApiErrorResponse } from "@/lib/server/utils/auth-helpers"
import { CourseGraphService } from "@/lib/server/services/course-graph.service"
import { GraphUpdateSchema } from "@/lib/server/validators/api.schemas"
import { logError } from "@/lib/observability/logger"

export const dynamic = "force-dynamic"

type RouteParams = { params: Promise<{ courseId: string }> }

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { userId, role } = await requireAuth()
    if (role === "guest") throw new ApiErrorResponse("Los cursos requieren una cuenta.", 403)
    const { courseId } = await params

    const graph = await CourseGraphService.getCourseGraph(userId, courseId)
    return NextResponse.json(graph)
  } catch (err) {
    if (err instanceof ApiErrorResponse) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    logError("api.graph.course_get_error", {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: "Failed to load course graph." }, { status: 500 })
  }
}

export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { userId, role } = await requireAuth()
    if (role === "guest") throw new ApiErrorResponse("Los cursos requieren una cuenta.", 403)
    const { courseId } = await params

    const parsed = GraphUpdateSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid graph" },
        { status: 400 },
      )
    }

    const graph = await CourseGraphService.updateCourseGraph(userId, courseId, parsed.data)
    return NextResponse.json(graph)
  } catch (err) {
    if (err instanceof ApiErrorResponse) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    logError("api.graph.course_patch_error", {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: "Failed to update course graph." }, { status: 500 })
  }
}
