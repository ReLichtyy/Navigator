/**
 * llm/config.ts — Central LLM configuration.
 *
 * Default provider, allowed models, free-tier defaults, cost estimates.
 */

import type { LLMProvider } from "./types"
import { flags } from "@/lib/config/flags"

export interface ModelDefinition {
  id: string
  provider: LLMProvider
  displayName: string
  contextWindow: number
  costPer1kPrompt: number // USD per 1K prompt tokens
  costPer1kCompletion: number // USD per 1K completion tokens
  tier: "free" | "pro" // minimum tier to use this model
}

// Driven by feature flags (DEFAULT_LLM_PROVIDER / DEFAULT_LLM_MODEL env vars) so
// the provider/model can be swapped per-deploy without a code change.
export const DEFAULT_PROVIDER: LLMProvider = flags.llmProvider
export const DEFAULT_MODEL = flags.llmModel

// Single user-facing model. Shown as "GPT-5.5" in the assistant picker, but the
// `id` is the real model sent to the provider (deepseek-v4-pro on DeepSeek) — the
// label is cosmetic.
export const MODELS: ModelDefinition[] = [
  {
    id: "deepseek-v4-pro",
    provider: "deepseek",
    displayName: "GPT-5.5",
    contextWindow: 128_000,
    // Pricing is an estimate — adjust to the real DeepSeek rate when published.
    costPer1kPrompt: 0.0003,
    costPer1kCompletion: 0.0011,
    tier: "free",
  },
]

/**
 * GPT-5 family + reasoning (o-series) models reject a non-default `temperature`
 * and require `max_completion_tokens` instead of `max_tokens`. Any caller that
 * builds raw OpenAI params (the RAG generators, the provider adapter) must omit
 * `temperature` for these models or the request 400s. Exported here — dep-free,
 * so importing it can't create a cycle — to keep one canonical definition.
 */
export function isNextGenModel(modelId: string): boolean {
  return /^(gpt-5|o[134])/.test(modelId)
}

/**
 * Models that reject a custom `temperature` (and other sampling params): the
 * GPT-5/o-series next-gen families plus reasoning models like DeepSeek-Reasoner.
 * Callers omit temperature for these to avoid 400s.
 */
export function isReasoningModel(modelId: string): boolean {
  return isNextGenModel(modelId) || /(reasoner|reasoning|deepseek-r|[-/]r1\b)/i.test(modelId)
}

// Warn (once per unknown id) when metering can't price a model, so a misconfigured
// DEFAULT_LLM_MODEL surfaces in logs instead of silently billing $0. See BUG-003.
const _warnedUnknownCost = new Set<string>()

/**
 * Estimate cost in USD for a given usage.
 */
export function estimateCost(
  modelId: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const model = MODELS.find((m) => m.id === modelId)
  if (!model) {
    if (!_warnedUnknownCost.has(modelId)) {
      _warnedUnknownCost.add(modelId)
      // eslint-disable-next-line no-console
      console.warn(
        `[metering] estimateCost: unknown model "${modelId}" — not in MODELS catalog; ` +
          `recording cost as 0. Add it to MODELS to meter spend accurately.`,
      )
    }
    return 0
  }
  return (
    (promptTokens / 1000) * model.costPer1kPrompt +
    (completionTokens / 1000) * model.costPer1kCompletion
  )
}

/**
 * Find a model definition by ID.
 */
export function getModelDef(modelId: string): ModelDefinition | undefined {
  return MODELS.find((m) => m.id === modelId)
}
