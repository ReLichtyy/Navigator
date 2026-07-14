/**
 * GET /api/study/[syllabusId]/exam?template=teorico|practico|mixto
 * Start an Examen attempt over one document: assembles the sectioned paper
 * (MCQ from the bank; short/development generated on demand), persists it and
 * returns it WITHOUT answers/rubrics. Mirrors /api/study/course/[courseId]/exam.
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

export async function GET(req: Request, { params }: { params: Promise<{ syllabusId: string }> }) {
  try {
    const { userId } = await requireAuth()
    const { syllabusId } = await params
    const parsed = TemplateParam.safeParse(
      new URL(req.url).searchParams.get("template") ?? undefined,
    )
    const data = await ExamService.start(userId, { kind: "doc", id: syllabusId }, {
      template: parsed.success ? parsed.data : undefined,
    })
    return NextResponse.json(data)
  } catch (err) {
    if (err instanceof ApiErrorResponse) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    logError("api.study.exam_error", {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: "Failed to start exam." }, { status: 500 })
  }
}
