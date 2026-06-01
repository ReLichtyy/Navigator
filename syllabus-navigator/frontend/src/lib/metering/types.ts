/**
 * metering/types.ts — Usage metering type definitions.
 */

export interface UsageRecord {
  userId: string
  provider: string
  model: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  estimatedCostUsd: number
  latencyMs: number
  chatId?: string
  success: boolean
  errorType?: string
}

export interface UsageSummary {
  totalRequests: number
  totalTokens: number
  totalCostUsd: number
  byModel: Record<string, { requests: number; tokens: number; costUsd: number }>
  periodDays: number
}
