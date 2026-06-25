/**
 * GET /api/study/session?syllabusId=… — the adaptive "today session": due
 * spaced-repetition reviews + new bank items ordered by topic priority (mastery
 * gaps × exam weight × schedule urgency). Closes the learning loop (Step 5).
 * Real users only (SRS/mastery are user-scoped).
 */
import { NextRequest, NextResponse } from "next/server"
import { requireAuth, ApiErrorResponse } from "@/lib/server/utils/auth-helpers"
import { DocumentRepository } from "@/lib/server/repositories/document.repo"
import { getTodaySession } from "@/lib/server/rag/orchestrator/planner"
import { logError } from "@/lib/observability/logger"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth()
    const syllabusId = req.nextUrl.searchParams.get("syllabusId")?.trim()
    if (!syllabusId) {
      return NextResponse.json({ error: "syllabusId is required." }, { status: 400 })
    }

    // Ownership gate (same as the rest of the study routes).
    const doc = await DocumentRepository.findByIdAndUser(syllabusId, userId)
    if (!doc) return NextResponse.json({ error: "Syllabus not found." }, { status: 404 })

    const session = await getTodaySession(userId, syllabusId)
    return NextResponse.json(session)
  } catch (err) {
    if (err instanceof ApiErrorResponse) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    logError("api.study.session_error", {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: "Failed to build study session." }, { status: 500 })
  }
}
