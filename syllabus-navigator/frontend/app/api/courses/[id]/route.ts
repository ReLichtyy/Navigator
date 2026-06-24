/**
 * /api/courses/[id] — rename or delete a user course.
 *   PATCH  { name } → rename
 *   DELETE          → remove the course (its documents survive, course_id → NULL)
 * Accounts only; guests get 403.
 */

import { NextResponse } from "next/server"
import { requireAuth, ApiErrorResponse } from "@/lib/server/utils/auth-helpers"
import { CourseService } from "@/lib/server/services/course.service"
import { logError, logInfo } from "@/lib/observability/logger"
import { invalidatePrefix } from "@/lib/cache"
import { z } from "zod"

export const dynamic = "force-dynamic"

type RouteParams = { params: Promise<{ id: string }> }

const RenameSchema = z.object({
  name: z.string().trim().min(1, "El nombre es obligatorio").max(120, "Nombre demasiado largo"),
})

export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { userId, role } = await requireAuth()
    if (role === "guest") throw new ApiErrorResponse("Los cursos requieren una cuenta.", 403)
    const { id } = await params

    const body = await request.json().catch(() => null)
    const parsed = RenameSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const course = await CourseService.renameCourse(id, userId, parsed.data.name)
    await invalidatePrefix(`uploads:list:${userId}`)
    logInfo("api.courses.renamed", { userId, courseId: id })
    return NextResponse.json({ course })
  } catch (err) {
    if (err instanceof ApiErrorResponse) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    logError("api.courses.rename_error", {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: "Failed to rename course." }, { status: 500 })
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
