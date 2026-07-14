/**
 * POST /api/study/exam/grade — grade a submitted Examen attempt. Body:
 * { kind, id, attemptId, answers: [{ key, response }] }. MCQ graded by index
 * against the stored paper; short/development answers graded by the LLM grader
 * with partial credit. Idempotent: a graded attempt returns its stored result.
 */
import { NextResponse } from "next/server"
import { requireAuth, ApiErrorResponse } from "@/lib/server/utils/auth-helpers"
import { ExamGradeSchema } from "@/lib/server/validators/api.schemas"
import { ExamService } from "@/lib/server/services/exam.service"
import type { StudyScope } from "@/lib/server/repositories/study-items.repo"
import { logError } from "@/lib/observability/logger"

export const dynamic = "force-dynamic"
// Grading calls the LLM grader over the open answers.
export const maxDuration = 300

export async function POST(req: Request) {
  try {
    const { userId } = await requireAuth()
    const parsed = ExamGradeSchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json({ error: "Invalid body." }, { status: 400 })
    const { kind, id, attemptId, answers } = parsed.data
    const scope: StudyScope = { kind, id }
    const data = await ExamService.grade(userId, scope, attemptId, answers)
    return NextResponse.json(data)
  } catch (err) {
    if (err instanceof ApiErrorResponse) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    logError("api.study.exam_grade_error", {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: "Failed to grade exam." }, { status: 500 })
  }
}
