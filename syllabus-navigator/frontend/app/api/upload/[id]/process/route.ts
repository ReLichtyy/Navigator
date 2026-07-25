/** POST /api/upload/[id]/process — enqueue durable document enrichment. */

import { NextResponse } from "next/server"
import { requireAuth, ApiErrorResponse } from "@/lib/server/utils/auth-helpers"
import { KnowledgePipelineService } from "@/lib/server/services/knowledge-pipeline.service"
import { invalidatePrefix } from "@/lib/cache"
import { logError, logInfo } from "@/lib/observability/logger"

export const dynamic = "force-dynamic"
export const maxDuration = 60

type RouteParams = { params: Promise<{ id: string }> }

export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const { userId } = await requireAuth()
    const { id } = await params

    const run = await KnowledgePipelineService.enqueueDocument(userId, id)
    await invalidatePrefix(`uploads:list:${userId}`)

    logInfo("api.upload.process", { userId, uploadId: id })
    return NextResponse.json(run, { status: 202 })
  } catch (err) {
    if (err instanceof ApiErrorResponse) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    logError("api.upload.process_error", {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: "Failed to process document." }, { status: 500 })
  }
}
