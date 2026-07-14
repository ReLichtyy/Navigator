/**
 * GET /api/schedule — the caller's agenda across all their courses.
 * Optional ?syllabusId=<id> returns the full schedule for one owned syllabus.
 * Optional ?tz=<IANA zone> — the browser's zone, so "today" is the student's
 * day and not the server's UTC day.
 */

import { NextResponse } from "next/server"
import { requireAuth, ApiErrorResponse } from "@/lib/server/utils/auth-helpers"
import { ScheduleService } from "@/lib/server/services/schedule.service"
import { logError } from "@/lib/observability/logger"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  try {
    const { userId } = await requireAuth()
    const params = new URL(request.url).searchParams
    const syllabusId = params.get("syllabusId")

    if (syllabusId) {
      const data = await ScheduleService.getForSyllabus(userId, syllabusId)
      return NextResponse.json(data)
    }
    const data = await ScheduleService.getAgenda(userId, params.get("tz"))
    return NextResponse.json(data)
  } catch (err) {
    if (err instanceof ApiErrorResponse) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    logError("api.schedule.get_error", { error: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: "Failed to load schedule." }, { status: 500 })
  }
}
