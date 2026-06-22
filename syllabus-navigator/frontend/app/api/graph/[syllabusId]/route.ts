/**
 * GET /api/graph/[syllabusId] — knowledge graph (topics + prerequisites) for a syllabus.
 * Returns GraphResponseAPI. 404 if the syllabus doesn't exist or isn't the caller's.
 */

import { NextResponse } from "next/server"
import { requireAuth, ApiErrorResponse } from "@/lib/server/utils/auth-helpers"
import { GraphService } from "@/lib/server/services/graph.service"
import { GraphUpdateSchema } from "@/lib/server/validators/api.schemas"
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

export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { userId } = await requireAuth()
    const { syllabusId } = await params

    const parsed = GraphUpdateSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid graph" }, { status: 400 })
    }

    const graph = await GraphService.updateGraph(userId, syllabusId, parsed.data)
    return NextResponse.json(graph)
  } catch (err) {
    if (err instanceof ApiErrorResponse) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    logError("api.graph.patch_error", {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: "Failed to update graph." }, { status: 500 })
  }
}
