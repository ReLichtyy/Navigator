/**
 * observability/trace.ts — Request-scoped trace ID management.
 *
 * Uses a simple module-scoped variable (safe for single-request Vercel
 * serverless invocations). For concurrent environments, upgrade to
 * AsyncLocalStorage.
 */

import { AsyncLocalStorage } from "node:async_hooks"

const traceStorage = new AsyncLocalStorage<string>()

/**
 * Get the current trace ID.
 */
export function getTraceId(): string | undefined {
  return traceStorage.getStore()
}
