/**
 * /api/cron/process — drain the async ingestion queue.
 *
 * Triggered two ways, both authenticated with CRON_SECRET:
 *   - Vercel Cron (GET), as the safety net for stuck/straggler jobs.
 *   - Fire-and-forget POST from the upload handler, for low-latency processing.
 *
 * Public in middleware (under /api/cron); fails CLOSED if CRON_SECRET is unset.
 */

import { NextResponse } from "next/server"
import { IngestionService } from "@/lib/server/services/ingestion.service"
import { logError } from "@/lib/observability/logger"

export const dynamic = "force-dynamic"
export const maxDuration = 60 // allow time for embeddings + graph LLM call

async function handle(request: Request) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    logError("cron.process.misconfigured", { reason: "CRON_SECRET not set" })
    return NextResponse.json({ error: "Cron not configured" }, { status: 500 })
  }
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const result = await IngestionService.drainQueue()
    return NextResponse.json({ message: "Queue drained", ...result }, { status: 200 })
  } catch (error) {
    logError("cron.process.error", { error: String(error) })
    return NextResponse.json({ error: "Failed to process queue" }, { status: 500 })
  }
}

export const GET = handle
export const POST = handle
