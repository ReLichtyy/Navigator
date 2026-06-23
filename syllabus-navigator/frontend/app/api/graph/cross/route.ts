/**
 * GET /api/graph/cross — multi-syllabus cross-course prerequisite graph (Sprint 4)
 * for all the caller's courses. Combined topics + intra-course prereq edges +
 * inferred cross-course "shared concept" bridges.
 */
import { NextResponse } from "next/server"
import { requireAuth, ApiErrorResponse } from "@/lib/server/utils/auth-helpers"
import { CrossGraphService } from "@/lib/server/services/cross-graph.service"
import { logError } from "@/lib/observability/logger"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const { userId } = await requireAuth()
    const graph = await CrossGraphService.get(userId)
    return NextResponse.json(graph)
  } catch (err) {
    if (err instanceof ApiErrorResponse) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    logError("api.graph.cross_error", { error: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: "Failed to load cross-course graph." }, { status: 500 })
  }
}
