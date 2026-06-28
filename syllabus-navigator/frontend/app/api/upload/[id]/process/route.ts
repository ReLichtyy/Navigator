/**
 * POST /api/upload/[id]/process — run the slow enrichment for a just-uploaded doc.
 *
 * The upload routes only embed inline (fast) so they return quickly and the file
 * shows up + becomes chat-ready immediately. The heavy generators (course
 * inference, graph, schedule — each a multi-second gpt-5.4 call) run here, fired
 * by the client AFTER the upload resolves and NOT awaited by the UI, which polls
 * graph_status to fill the result in. This keeps the upload request well under the
 * serverless time cap (previously the inline graph/schedule could time out and the
 * new row would vanish). The daily Vercel Cron on /api/cron/process is the backstop
 * if the client never fires this (e.g. tab closed).
 */

import { NextResponse } from "next/server"
import { requireAuth, ApiErrorResponse } from "@/lib/server/utils/auth-helpers"
import { triggerIngestionWorker } from "@/lib/server/services/worker-trigger"
import { invalidatePrefix } from "@/lib/cache"
import { logError, logInfo } from "@/lib/observability/logger"

export const dynamic = "force-dynamic"
export const maxDuration = 60 // graph + schedule + inference (gpt-5.4) run inline here

type RouteParams = { params: Promise<{ id: string }> }

export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const { userId } = await requireAuth()
    const { id } = await params

    // Drains the pending ingest job(s): embeddings are already done, so this runs
    // the graph/schedule/inference enrichment and completes the job.
    await triggerIngestionWorker()
    await invalidatePrefix(`uploads:list:${userId}`)

    logInfo("api.upload.process", { userId, uploadId: id })
    return NextResponse.json({ ok: true })
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
