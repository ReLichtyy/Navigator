/**
 * GET /api/mastery/[syllabusId] — per-topic mastery for a syllabus the caller owns.
 */
import { NextResponse } from "next/server"
import { requireAuth, ApiErrorResponse } from "@/lib/server/utils/auth-helpers"
import { MasteryService } from "@/lib/server/services/mastery.service"
import { logError } from "@/lib/observability/logger"

export const dynamic = "force-dynamic"

export async function GET(_req: Request, { params }: { params: Promise<{ syllabusId: string }> }) {
  try {
    const { userId } = await requireAuth()
    const { syllabusId } = await params
    const topics = await MasteryService.forSyllabus(userId, syllabusId)
    return NextResponse.json({ syllabus_id: syllabusId, topics })
  } catch (err) {
    if (err instanceof ApiErrorResponse) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    logError("api.mastery.syllabus_get_error", {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: "Failed to load mastery." }, { status: 500 })
  }
}
