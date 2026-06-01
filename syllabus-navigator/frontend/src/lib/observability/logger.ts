/**
 * observability/logger.ts — Structured JSON logger for Vercel serverless.
 *
 * Writes to stdout as single-line JSON so Vercel log ingestion can parse it.
 * Every entry includes timestamp, level, event name, and optional context.
 */

export type LogLevel = "info" | "warn" | "error"

export type LogContext = Record<string, unknown>

const LOG_LEVELS: Record<LogLevel, number> = { info: 0, warn: 1, error: 2 }

const configuredLevel: LogLevel =
  (process.env.LOG_LEVEL as LogLevel) ?? "info"

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[configuredLevel]
}

/**
 * Emit a structured log entry.
 *
 * @example
 * log("info", "llm.call", { provider: "openai", model: "gpt-4o-mini", latencyMs: 342 })
 */
export function log(
  level: LogLevel,
  event: string,
  data?: LogContext,
): void {
  if (!shouldLog(level)) return

  const entry = {
    timestamp: new Date().toISOString(),
    level,
    event,
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
export const logInfo = (event: string, data?: LogContext) =>
  log("info", event, data)

/** Convenience: log at warn level. */
export const logWarn = (event: string, data?: LogContext) =>
  log("warn", event, data)

/** Convenience: log at error level. */
export const logError = (event: string, data?: LogContext) =>
  log("error", event, data)
