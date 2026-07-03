/**
 * POST /api/graph/[syllabusId]/reprocess — re-run graph generation.
 * Re-enqueues the ingest job, marks graph_status='pending', kicks the worker.
 * Returns the current (pending) GraphResponseAPI.
 */

import { NextResponse } from "next/server"
import { requireAuth, ApiErrorResponse } from "@/lib/server/utils/auth-helpers"
import { GraphService } from "@/lib/server/services/graph.service"
import { IngestionService } from "@/lib/server/services/ingestion.service"
import { logError, logInfo } from "@/lib/observability/logger"

export const dynamic = "force-dynamic"
export const maxDuration = 60 // graph LLM runs inline before responding

type RouteParams = { params: Promise<{ syllabusId: string }> }

export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const { userId } = await requireAuth()
    const { syllabusId } = await params

    const graph = await GraphService.reprocess(userId, syllabusId)

    // Drain only this syllabus's job inline: one job (~35s) fits maxDuration=60,
    // and the clicked doc can't be starved by older jobs from other documents.
    await IngestionService.drainForSyllabus(syllabusId)

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
