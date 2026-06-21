/**
 * server/services/worker-trigger.ts — kick the async ingestion worker.
 *
 * Preferred path (prod): fire-and-forget POST to /api/cron/process so the upload
 * response returns immediately and the worker runs in a separate invocation.
 * Fallback (dev / missing config): run the queue inline so ingestion still happens.
 * Either way, the Vercel Cron on /api/cron/process is the safety net for stragglers.
 */

import { IngestionService } from "./ingestion.service"
import { logWarn } from "@/lib/observability/logger"

function baseUrl(): string | null {
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return process.env.NEXTAUTH_URL ?? null
}

export function triggerIngestionWorker(): void {
  const url = baseUrl()
  const secret = process.env.CRON_SECRET

  // Fire-and-forget HTTP trigger (non-blocking) when we can authenticate it.
  if (url && secret) {
    fetch(`${url}/api/cron/process`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
    }).catch((err) => {
      logWarn("worker.trigger.failed", { error: err instanceof Error ? err.message : String(err) })
    })
    return
  }

  // Dev fallback: drain inline. Not awaited by the caller's response path, but
  // kept alive within the request. Cron remains the backstop in production.
  logWarn("worker.trigger.inline", { reason: !url ? "no base url" : "no CRON_SECRET" })
  IngestionService.drainQueue().catch(() => {})
}
