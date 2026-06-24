/**
 * observability/logger.ts — Structured JSON logger for Vercel serverless.
 *
 * Writes to stdout as single-line JSON so Vercel log ingestion can parse it.
 * Every entry includes timestamp, level, event name, and optional context.
 */

import { getTraceId } from "./trace"

export type LogLevel = "info" | "warn" | "error"

export type LogContext = Record<string, unknown>

const LOG_LEVELS: Record<LogLevel, number> = { info: 0, warn: 1, error: 2 }

const configuredLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) ?? "info"

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[configuredLevel]
}

/**
 * Emit a structured log entry.
 *
 * @example
 * log("info", "llm.call", { provider: "openai", model: "gpt-4o-mini", latencyMs: 342 })
 */
export function log(level: LogLevel, event: string, data?: LogContext): void {
  if (!shouldLog(level)) return

  // Inyectamos el traceId dinámicamente si está disponible
  let traceId: string | undefined
  try {
    traceId = getTraceId()
  } catch {
    // ignorar
  }

  // Fallback a next/headers para App Router
  if (!traceId) {
    try {
      const { headers } = require("next/headers")
      traceId = headers().get("x-trace-id") ?? undefined
    } catch {
      // No estamos en el contexto de un request de Next.js
    }
  }

  const entry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...(traceId ? { traceId } : {}),
    ...data,
  }

  const line = JSON.stringify(entry)

  switch (level) {
    case "error":
      console.error(line)
      break
    case "warn":
      console.warn(line)
      break
    default:
      console.log(line)
  }
}

/** Convenience: log at info level. */
export const logInfo = (event: string, data?: LogContext) => log("info", event, data)

/** Convenience: log at warn level. */
export const logWarn = (event: string, data?: LogContext) => log("warn", event, data)

/** Convenience: log at error level. */
export const logError = (event: string, data?: LogContext) => log("error", event, data)
