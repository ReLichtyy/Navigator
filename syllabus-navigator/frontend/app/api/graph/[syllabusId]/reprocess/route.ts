/**
 * POST /api/graph/[syllabusId]/reprocess — re-run graph generation.
 * Re-enqueues the ingest job and starts its durable workflow.
 * Returns 202 + ArtifactRunAPI immediately; no LLM runs in this request.
 */

import { NextResponse } from "next/server"
import { requireAuth, ApiErrorResponse } from "@/lib/server/utils/auth-helpers"
import { GraphService } from "@/lib/server/services/graph.service"
import { logError, logInfo } from "@/lib/observability/logger"

export const dynamic = "force-dynamic"
export const maxDuration = 15

type RouteParams = { params: Promise<{ syllabusId: string }> }

export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const { userId } = await requireAuth()
    const { syllabusId } = await params

    const run = await GraphService.reprocess(userId, syllabusId)

    logInfo("api.graph.reprocess", { userId, syllabusId })
    return NextResponse.json(run, { status: 202 })
  } catch (err) {
    if (err instanceof ApiErrorResponse) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    logError("api.graph.reprocess_error", {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: "Failed to reprocess graph." }, { status: 500 })
  }
}
