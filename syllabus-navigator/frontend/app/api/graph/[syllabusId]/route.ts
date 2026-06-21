/**
 * GET /api/graph/[syllabusId] — knowledge graph (topics + prerequisites) for a syllabus.
 * Returns GraphResponseAPI. 404 if the syllabus doesn't exist or isn't the caller's.
 */

import { NextResponse } from "next/server"
import { requireAuth, ApiErrorResponse } from "@/lib/server/utils/auth-helpers"
import { GraphService } from "@/lib/server/services/graph.service"
import { logError } from "@/lib/observability/logger"

export const dynamic = "force-dynamic"

type RouteParams = { params: Promise<{ syllabusId: string }> }

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { userId } = await requireAuth()
    const { syllabusId } = await params

    const graph = await GraphService.getGraph(userId, syllabusId)
    return NextResponse.json(graph)
  } catch (err) {
    if (err instanceof ApiErrorResponse) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    logError("api.graph.get_error", {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: "Failed to load graph." }, { status: 500 })
  }
}
