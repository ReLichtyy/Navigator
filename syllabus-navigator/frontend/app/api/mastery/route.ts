/**
 * /api/mastery
 *   POST — record a batch of quiz outcomes ({ syllabus_id, outcomes:[{label,correct}] }).
 *   GET  — course-level mastery overview across all the caller's syllabi.
 * Both require auth; recording 404s when the syllabus isn't the caller's.
 */
import { NextResponse } from "next/server"
import { requireAuth, ApiErrorResponse } from "@/lib/server/utils/auth-helpers"
import { MasteryService } from "@/lib/server/services/mastery.service"
import { MasteryRecordSchema } from "@/lib/server/validators/api.schemas"
import { logError } from "@/lib/observability/logger"

export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  try {
    const { userId } = await requireAuth()
    const parsed = MasteryRecordSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid body" },
        { status: 400 },
      )
    }
    await MasteryService.record(userId, parsed.data.syllabus_id, parsed.data.outcomes)
    return NextResponse.json({ success: true })
  } catch (err) {
    if (err instanceof ApiErrorResponse) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    logError("api.mastery.post_error", { error: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: "Failed to record mastery." }, { status: 500 })
  }
}

export async function GET() {
  try {
    const { userId } = await requireAuth()
    const courses = await MasteryService.overview(userId)
    return NextResponse.json({ courses })
  } catch (err) {
    if (err instanceof ApiErrorResponse) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    logError("api.mastery.get_error", { error: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: "Failed to load mastery." }, { status: 500 })
  }
}
