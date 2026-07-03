/**
 * POST /api/study/quiz-seen — mark quiz bank items as served to the caller so
 * future sessions don't repeat them. Body: { kind, id, itemIds[] }. Fire-and-forget
 * from the client at stage/quiz end.
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAuth, ApiErrorResponse } from "@/lib/server/utils/auth-helpers"
import { StudyService } from "@/lib/server/services/study.service"
import type { StudyScope } from "@/lib/server/repositories/study-items.repo"
import { logError } from "@/lib/observability/logger"

export const dynamic = "force-dynamic"

const Body = z.object({
  kind: z.enum(["doc", "course"]),
  id: z.string().uuid(),
  itemIds: z.array(z.string().uuid()).max(500),
})

export async function POST(req: Request) {
  try {
    const { userId } = await requireAuth()
    const parsed = Body.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json({ error: "Invalid body." }, { status: 400 })
    const { kind, id, itemIds } = parsed.data
    const scope: StudyScope = { kind, id }
    await StudyService.recordQuizSeen(userId, scope, itemIds)
    return NextResponse.json({ success: true })
  } catch (err) {
    if (err instanceof ApiErrorResponse) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    logError("api.study.quiz_seen_error", {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: "Failed to record seen items." }, { status: 500 })
  }
}
