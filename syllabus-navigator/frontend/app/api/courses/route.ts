/**
 * /api/courses — user course management (Course Intelligence Layer).
 *   GET  → list the caller's courses (with document counts)
 *   POST → create a course
 * Accounts only; guests get 403 (inference/courses are not for ephemeral users).
 */

import { NextResponse } from "next/server"
import { requireAuth, ApiErrorResponse } from "@/lib/server/utils/auth-helpers"
import { CourseService } from "@/lib/server/services/course.service"
import { CreateCourseSchema } from "@/lib/server/validators/api.schemas"
import { logError, logInfo } from "@/lib/observability/logger"
import { invalidatePrefix } from "@/lib/cache"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const { userId, role } = await requireAuth()
    if (role === "guest") throw new ApiErrorResponse("Los cursos requieren una cuenta.", 403)

    const courses = await CourseService.listCourses(userId)
    return NextResponse.json({ courses })
  } catch (err) {
    if (err instanceof ApiErrorResponse) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    logError("api.courses.list_error", { error: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: "Failed to load courses." }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const { userId, role } = await requireAuth()
    if (role === "guest") throw new ApiErrorResponse("Los cursos requieren una cuenta.", 403)

    const body = await request.json().catch(() => null)
    const parsed = CreateCourseSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Datos inválidos." },
        { status: 400 },
      )
    }

    const course = await CourseService.createCourse(userId, {
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      subjectTags: parsed.data.subject_tags ?? null,
      color: parsed.data.color ?? null,
    })
    await invalidatePrefix(`uploads:list:${userId}`)

    logInfo("api.courses.created", { userId, courseId: course.id })
    return NextResponse.json({ course }, { status: 201 })
  } catch (err) {
    if (err instanceof ApiErrorResponse) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    logError("api.courses.create_error", {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: "Failed to create course." }, { status: 500 })
  }
}
