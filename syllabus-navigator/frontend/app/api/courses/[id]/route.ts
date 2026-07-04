/**
 * /api/courses/[id] — update or delete a user course.
 *   PATCH  { name?, term_start? } → rename and/or set the "Semana N" anchor
 *   DELETE                        → remove the course (its documents survive, course_id → NULL)
 * Accounts only; guests get 403.
 */

import { NextResponse } from "next/server"
import { requireAuth, ApiErrorResponse } from "@/lib/server/utils/auth-helpers"
import { CourseService } from "@/lib/server/services/course.service"
import { UpdateCourseSchema } from "@/lib/server/validators/api.schemas"
import { logError, logInfo } from "@/lib/observability/logger"
import { invalidatePrefix } from "@/lib/cache"

export const dynamic = "force-dynamic"

type RouteParams = { params: Promise<{ id: string }> }

export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { userId, role } = await requireAuth()
    if (role === "guest") throw new ApiErrorResponse("Los cursos requieren una cuenta.", 403)
    const { id } = await params

    const body = await request.json().catch(() => null)
    const parsed = UpdateCourseSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const course = await CourseService.updateCourse(id, userId, {
      name: parsed.data.name,
      termStart: parsed.data.term_start,
    })
    await invalidatePrefix(`uploads:list:${userId}`)
    logInfo("api.courses.updated", { userId, courseId: id })
    return NextResponse.json({ course })
  } catch (err) {
    if (err instanceof ApiErrorResponse) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    logError("api.courses.update_error", {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: "Failed to update course." }, { status: 500 })
  }
}

export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    const { userId, role } = await requireAuth()
    if (role === "guest") throw new ApiErrorResponse("Los cursos requieren una cuenta.", 403)
    const { id } = await params

    await CourseService.deleteCourse(id, userId)
    await invalidatePrefix(`uploads:list:${userId}`)
    logInfo("api.courses.deleted", { userId, courseId: id })
    return NextResponse.json({ success: true })
  } catch (err) {
    if (err instanceof ApiErrorResponse) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    logError("api.courses.delete_error", {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: "Failed to delete course." }, { status: 500 })
  }
}
