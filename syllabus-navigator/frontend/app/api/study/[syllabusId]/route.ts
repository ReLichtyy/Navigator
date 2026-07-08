/**
 * GET /api/study/[syllabusId] — study material (flashcards/quiz/summary/mindmap)
 * for a syllabus the caller owns. `?refresh=1` regenerates and re-caches it.
 */

import { NextResponse } from "next/server"
import { requireAuth, ApiErrorResponse } from "@/lib/server/utils/auth-helpers"
import { StudyService } from "@/lib/server/services/study.service"
import { logError } from "@/lib/observability/logger"

export const dynamic = "force-dynamic"
// Cold path generates via LLM agents before responding — 60s produced
// FUNCTION_INVOCATION_TIMEOUT on slow generations. 300s needs Fluid compute
// (default on current Vercel deployments); drop back to 60 if the plan rejects it.
export const maxDuration = 300

export async function GET(req: Request, { params }: { params: Promise<{ syllabusId: string }> }) {
  try {
    const { userId } = await requireAuth()
    const { syllabusId } = await params
    const sp = new URL(req.url).searchParams
    const refresh = sp.get("refresh") === "1"
    const d = sp.get("difficulty")
    const difficulty = d === "facil" || d === "medio" || d === "dificil" ? d : undefined
    const topic = sp.get("topic")?.slice(0, 160) || undefined
    const web = sp.get("web") === "1"

    const data = await StudyService.getStudySet(userId, syllabusId, {
      refresh,
      difficulty,
      topic,
      web,
    })
    return NextResponse.json({ syllabus_id: syllabusId, ...data })
  } catch (err) {
    if (err instanceof ApiErrorResponse) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    logError("api.study.get_error", {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: "Failed to load study material." }, { status: 500 })
  }
}
