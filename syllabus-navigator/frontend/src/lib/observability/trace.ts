/**
 * observability/trace.ts — Request-scoped trace ID management.
 *
 * Uses a simple module-scoped variable (safe for single-request Vercel
 * serverless invocations). For concurrent environments, upgrade to
 * AsyncLocalStorage.
 */

import { AsyncLocalStorage } from "node:async_hooks"

export const traceStorage = new AsyncLocalStorage<string>()

/**
 * Generate and set a new trace ID for the current request.
 * Call this early in middleware or route handlers.
 */
export function startTrace(): string {
  return crypto.randomUUID()
}

/**
 * Get the current trace ID.
 */
export function getTraceId(): string | undefined {
  return traceStorage.getStore()
}

/**
 * Clear the trace ID (at the end of a request lifecycle).
 * (Not strictly necessary when using AsyncLocalStorage.run, but kept for API compat).
 */
export function clearTrace(): void {
  // No-op for AsyncLocalStorage
}

/**
 * Execute a function within a trace context.
 */
export async function withTrace<T>(fn: () => Promise<T>): Promise<{ result: T; traceId: string }> {
  const traceId = startTrace()
  const result = await traceStorage.run(traceId, fn)
  return { result, traceId }
}
