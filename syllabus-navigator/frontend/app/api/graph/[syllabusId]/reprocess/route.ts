/**
 * POST /api/graph/[syllabusId]/reprocess — re-run graph generation.
 * Re-enqueues the ingest job, marks graph_status='pending', kicks the worker.
 * Returns the current (pending) GraphResponseAPI.
 */

import { NextResponse } from "next/server"
import { requireAuth, ApiErrorResponse } from "@/lib/server/utils/auth-helpers"
import { GraphService } from "@/lib/server/services/graph.service"
import { triggerIngestionWorker } from "@/lib/server/services/worker-trigger"
import { logError, logInfo } from "@/lib/observability/logger"

export const dynamic = "force-dynamic"
export const maxDuration = 60 // graph LLM runs inline before responding

type RouteParams = { params: Promise<{ syllabusId: string }> }

export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const { userId } = await requireAuth()
    const { syllabusId } = await params

    const graph = await GraphService.reprocess(userId, syllabusId)

    // Run the worker inline so it completes on serverless before we respond.
    await triggerIngestionWorker()

    logInfo("api.graph.reprocess", { userId, syllabusId })
    return NextResponse.json(graph)
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
