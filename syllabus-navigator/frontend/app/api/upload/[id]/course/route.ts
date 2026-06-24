/**
 * POST /api/upload/[id]/course — act on a document's course suggestion.
 *
 * body: { action: 'confirm' | 'reject' | 'skip', course_id?, new_course_name?, new_course_tags? }
 *   confirm → assign course_id (existing course, a new one, or the standing suggestion)
 *   reject  → leave the document without a course
 *   skip    → defer the decision
 * Only on confirm does the document actually get a course_id.
 */

import { NextResponse } from "next/server"
import { requireAuth, ApiErrorResponse } from "@/lib/server/utils/auth-helpers"
import { CourseService } from "@/lib/server/services/course.service"
import { CourseActionSchema } from "@/lib/server/validators/api.schemas"
import { logError, logInfo } from "@/lib/observability/logger"
import { invalidatePrefix } from "@/lib/cache"

export const dynamic = "force-dynamic"

type RouteParams = { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { userId, role } = await requireAuth()
    if (role === "guest") throw new ApiErrorResponse("Los cursos requieren una cuenta.", 403)
    const { id } = await params

    const body = await request.json().catch(() => null)
    const parsed = CourseActionSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Datos inválidos." },
        { status: 400 },
      )
    }

    const { action, course_id, new_course_name, new_course_tags } = parsed.data

    let upload
    if (action === "confirm") {
      upload = await CourseService.confirm(id, userId, {
        courseId: course_id ?? undefined,
        newCourse: new_course_name
          ? { name: new_course_name, subjectTags: new_course_tags ?? undefined }
          : undefined,
      })
    } else if (action === "reject") {
      upload = await CourseService.reject(id, userId)
    } else {
      upload = await CourseService.skip(id, userId)
    }

    await invalidatePrefix(`uploads:list:${userId}`)
    logInfo("api.upload.course_action", { userId, docId: id, action })

    return NextResponse.json({ upload })
  } catch (err) {
    if (err instanceof ApiErrorResponse) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    logError("api.upload.course_error", {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: "Failed to update course." }, { status: 500 })
  }
}
