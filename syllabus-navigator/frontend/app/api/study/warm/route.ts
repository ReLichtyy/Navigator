/**
 * POST /api/study/warm — fill the quiz bank in the background.
 *
 * Called fire-and-forget by the client while the student is idle (reading the
 * estudio menu, answering the current stage). Without it the only drainers of a
 * `study-bank` job are the daily cron and a serve request with an empty pool, so
 * generation always ended up inside a request the student was waiting on.
 *
 * Body: { kind, id }. Slow by design (it runs LLM generation) — the caller must
 * not await it.
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAuth, ApiErrorResponse } from "@/lib/server/utils/auth-helpers"
import { StudyService } from "@/lib/server/services/study.service"
import { logError } from "@/lib/observability/logger"

export const dynamic = "force-dynamic"
// Generation runs here on purpose (that's the whole point) — same budget as the
// serve routes. Needs Fluid compute, default on current Vercel deployments.
export const maxDuration = 300

const Body = z.object({ kind: z.enum(["doc", "course"]), id: z.string().uuid() })

export async function POST(req: Request) {
  try {
    const { userId } = await requireAuth()
    const parsed = Body.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json({ error: "Invalid body." }, { status: 400 })

    const result = await StudyService.warmBank(userId, parsed.data)
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof ApiErrorResponse) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    logError("api.study.warm_error", {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: "Failed to warm the question bank." }, { status: 500 })
  }
}
