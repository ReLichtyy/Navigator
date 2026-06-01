/**
 * observability/trace.ts — Request-scoped trace ID management.
 *
 * Uses a simple module-scoped variable (safe for single-request Vercel
 * serverless invocations). For concurrent environments, upgrade to
 * AsyncLocalStorage.
 */

import { randomUUID } from "crypto"

let _currentTraceId: string | null = null

/**
 * Generate and set a new trace ID for the current request.
 * Call this early in middleware or route handlers.
 */
export function startTrace(): string {
  _currentTraceId = randomUUID()
  return _currentTraceId
}

/**
 * Get the current trace ID, or generate one if none exists.
 */
export function getTraceId(): string {
  if (!_currentTraceId) _currentTraceId = randomUUID()
  return _currentTraceId
}

/**
 * Clear the trace ID (at the end of a request lifecycle).
 */
export function clearTrace(): void {
  _currentTraceId = null
}

/**
 * Execute a function within a trace context.
 */
export async function withTrace<T>(fn: () => Promise<T>): Promise<{ result: T; traceId: string }> {
  const traceId = startTrace()
  try {
    const result = await fn()
    return { result, traceId }
  } finally {
    clearTrace()
  }
}
