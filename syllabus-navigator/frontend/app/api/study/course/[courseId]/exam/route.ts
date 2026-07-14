/**
 * GET /api/study/course/[courseId]/exam?template=teorico|practico|mixto
 * Start an Examen attempt aggregated across a whole course the caller owns.
 * Mirrors /api/study/[syllabusId]/exam. Accounts only.
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAuth, ApiErrorResponse } from "@/lib/server/utils/auth-helpers"
import { ExamService } from "@/lib/server/services/exam.service"
import { logError } from "@/lib/observability/logger"

export const dynamic = "force-dynamic"
// Cold path generates short/development items via LLM agents before responding.
export const maxDuration = 300

const TemplateParam = z.enum(["teorico", "practico", "mixto"]).optional()

export async function GET(req: Request, { params }: { params: Promise<{ courseId: string }> }) {
  try {
    const { userId, role } = await requireAuth()
    if (role === "guest") throw new ApiErrorResponse("Los cursos requieren una cuenta.", 403)
    const { courseId } = await params
    const parsed = TemplateParam.safeParse(
      new URL(req.url).searchParams.get("template") ?? undefined,
    )
    const data = await ExamService.start(userId, { kind: "course", id: courseId }, {
      template: parsed.success ? parsed.data : undefined,
    })
    return NextResponse.json(data)
  } catch (err) {
    if (err instanceof ApiErrorResponse) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    logError("api.study.course_exam_error", {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: "Failed to start exam." }, { status: 500 })
  }
}
