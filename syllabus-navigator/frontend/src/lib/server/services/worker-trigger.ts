/**
 * server/services/worker-trigger.ts — run the async ingestion worker.
 *
 * We drain the queue INLINE (and awaited by the caller) instead of a
 * fire-and-forget POST to /api/cron/process. On serverless (Vercel) the function
 * is frozen once the HTTP response is sent, so an un-awaited fetch/Promise is not
 * guaranteed to run — which left uploads stuck on "processing" forever. Draining
 * in the same invocation guarantees embeddings + graph actually complete before
 * the route responds. The Vercel Cron on /api/cron/process stays as the backstop.
 */

import { IngestionService } from "./ingestion.service"
import { logWarn } from "@/lib/observability/logger"

export async function triggerIngestionWorker(): Promise<void> {
  try {
    await IngestionService.drainQueue()
  } catch (err) {
    logWarn("worker.trigger.failed", { error: err instanceof Error ? err.message : String(err) })
  }
}
