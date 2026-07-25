import { NextResponse } from "next/server"
import { ArtifactRunRepository } from "@/lib/server/repositories/artifact-run.repo"
import { ApiErrorResponse, requireAuth } from "@/lib/server/utils/auth-helpers"
import { logError } from "@/lib/observability/logger"

export const dynamic = "force-dynamic"

type RouteParams = { params: Promise<{ runId: string }> }

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { userId } = await requireAuth()
    const { runId } = await params
    const run = await ArtifactRunRepository.getByIdAndUser(runId, userId)
    if (!run) return NextResponse.json({ error: "Artifact run not found." }, { status: 404 })
    return NextResponse.json(run)
  } catch (err) {
    if (err instanceof ApiErrorResponse) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    logError("api.artifact_run.get_error", {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: "Failed to load artifact progress." }, { status: 500 })
  }
}
