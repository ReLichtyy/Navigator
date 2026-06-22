/**
 * GET /api/schedule — the caller's agenda across all their courses.
 * Optional ?syllabusId=<id> returns the full schedule for one owned syllabus.
 */

import { NextResponse } from "next/server"
import { requireAuth, ApiErrorResponse } from "@/lib/server/utils/auth-helpers"
import { ScheduleService } from "@/lib/server/services/schedule.service"
import { logError } from "@/lib/observability/logger"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  try {
    const { userId } = await requireAuth()
    const syllabusId = new URL(request.url).searchParams.get("syllabusId")

    if (syllabusId) {
      const data = await ScheduleService.getForSyllabus(userId, syllabusId)
      return NextResponse.json(data)
    }
    const data = await ScheduleService.getAgenda(userId)
    return NextResponse.json(data)
  } catch (err) {
    if (err instanceof ApiErrorResponse) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    logError("api.schedule.get_error", { error: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: "Failed to load schedule." }, { status: 500 })
  }
}
