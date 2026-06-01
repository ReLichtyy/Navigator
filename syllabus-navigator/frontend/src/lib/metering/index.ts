/**
 * metering/index.ts — Usage metering service.
 *
 * Records every LLM call to Neon for cost tracking and analytics.
 * Uses fire-and-forget writes so metering never blocks the response.
 */

import { sql } from "@/lib/db"
import { logError, logInfo } from "@/lib/observability/logger"
import type { UsageRecord, UsageSummary } from "./types"

/**
 * Record a single LLM usage event.
 * Returns a Promise so it can be awaited (required for Serverless environments
 * to prevent the function from terminating before the DB write completes).
 */
export async function recordUsage(record: UsageRecord): Promise<void> {
  try {
    await _writeRecord(record)
  } catch (err) {
    // We log the error but don't throw it to avoid breaking the user experience
    // just because metering failed.
    logError("metering.write_error", {
      error: err instanceof Error ? err.message : String(err),
      userId: record.userId,
    })
  }
}

async function _writeRecord(record: UsageRecord): Promise<void> {
  await sql`
    INSERT INTO usage_records (
      user_id, provider, model,
      prompt_tokens, completion_tokens, total_tokens,
      estimated_cost_usd, latency_ms, chat_id,
      success, error_type
    ) VALUES (
      ${record.userId}::uuid, ${record.provider}, ${record.model},
      ${record.promptTokens}, ${record.completionTokens}, ${record.totalTokens},
      ${record.estimatedCostUsd}, ${record.latencyMs},
      ${record.chatId ? record.chatId : null}::uuid,
      ${record.success}, ${record.errorType ?? null}
    )
  `
  logInfo("metering.recorded", {
    userId: record.userId,
    model: record.model,
    tokens: record.totalTokens,
    costUsd: record.estimatedCostUsd,
  })
}

/**
 * Get aggregated usage for a user over a given period.
 */
export async function getUserUsage(
  userId: string,
  periodDays = 30,
): Promise<UsageSummary> {
  const rows = await sql`
    SELECT
      model,
      COUNT(*)::int AS requests,
      COALESCE(SUM(total_tokens), 0)::int AS tokens,
      COALESCE(SUM(estimated_cost_usd), 0)::numeric AS cost_usd
    FROM usage_records
    WHERE user_id = ${userId}::uuid
      AND created_at >= now() - make_interval(days => ${periodDays})
    GROUP BY model
  `

  const byModel: Record<string, { requests: number; tokens: number; costUsd: number }> = {}
  let totalRequests = 0
  let totalTokens = 0
  let totalCostUsd = 0

  for (const row of rows as { model: string; requests: number; tokens: number; cost_usd: string }[]) {
    const costUsd = parseFloat(row.cost_usd)
    byModel[row.model] = {
      requests: row.requests,
      tokens: row.tokens,
      costUsd,
    }
    totalRequests += row.requests
    totalTokens += row.tokens
    totalCostUsd += costUsd
  }

  return { totalRequests, totalTokens, totalCostUsd, byModel, periodDays }
}

export type { UsageRecord, UsageSummary } from "./types"
