/**
 * observability/timing.ts — High-resolution timer utility.
 *
 * Wraps any async function and returns its result + elapsed milliseconds.
 * Used by LLM calls, DB queries, and cache operations.
 */

import { logWarn } from "./logger"

/**
 * Execute `fn` and measure how long it takes.
 *
 * @example
 * const { result, ms } = await timed("llm.call", () => openai.chat(...))
 * log("info", "llm.call", { latencyMs: ms })
 */
export async function timed<T>(
  name: string,
  fn: () => Promise<T>,
  slowThresholdMs = 2000,
): Promise<{ result: T; ms: number }> {
  const start = performance.now()
  const result = await fn()
  const ms = Math.round(performance.now() - start)

  if (ms > slowThresholdMs) {
    logWarn("slow_operation", { operation: name, latencyMs: ms })
  }

  return { result, ms }
}
