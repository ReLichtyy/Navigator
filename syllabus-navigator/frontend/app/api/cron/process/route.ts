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
import { StudyBankService } from "@/lib/server/services/study-bank.service"
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
    // Also fill any pending study-bank jobs (staged-quiz question banks) so they
    // top up even when nobody is actively polling the quiz.
    const study = await StudyBankService.drain(3).catch((err) => {
      logError("cron.process.study_drain_error", { error: String(err) })
      return { processed: 0, failed: 0 }
    })
    return NextResponse.json({ message: "Queue drained", ...result, study }, { status: 200 })
  } catch (error) {
    logError("cron.process.error", { error: String(error) })
    return NextResponse.json({ error: "Failed to process queue" }, { status: 500 })
  }
}

export const GET = handle
export const POST = handle
