/**
 * GET /api/study/stats — study streak + cards-reviewed-this-week for the
 * signed-in user. Powers the sidebar streak card (UI-13).
 */
import { NextResponse } from "next/server"
import { requireAuth, ApiErrorResponse } from "@/lib/server/utils/auth-helpers"
import { StudyStatsRepository } from "@/lib/server/repositories/study-stats.repo"
import { logError } from "@/lib/observability/logger"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const { userId } = await requireAuth()
    const stats = await StudyStatsRepository.getStats(userId)
    return NextResponse.json(stats)
  } catch (err) {
    if (err instanceof ApiErrorResponse) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    logError("api.study.stats_error", {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: "Failed to load study stats." }, { status: 500 })
  }
}
