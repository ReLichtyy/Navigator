/**
 * llm/config.ts — Central LLM configuration.
 *
 * Default provider, allowed models, free-tier defaults, cost estimates.
 */

import type { LLMProvider } from "./types"

export interface ModelDefinition {
  id: string
  provider: LLMProvider
  displayName: string
  contextWindow: number
  costPer1kPrompt: number   // USD per 1K prompt tokens
  costPer1kCompletion: number // USD per 1K completion tokens
  tier: "free" | "pro"       // minimum tier to use this model
}

export const DEFAULT_PROVIDER: LLMProvider = "openai"
export const DEFAULT_MODEL = "gpt-4o-mini"

export const MODELS: ModelDefinition[] = [
  {
    id: "gpt-5.5",
    provider: "openai",
    displayName: "GPT-5.5",
    contextWindow: 400_000,
    // Pricing is an estimate — adjust to the real OpenAI rate when published.
    costPer1kPrompt: 0.005,
    costPer1kCompletion: 0.015,
    tier: "pro",
  },
  {
    id: "gpt-4o-mini",
    provider: "openai",
    displayName: "GPT-4o Mini",
    contextWindow: 128_000,
    costPer1kPrompt: 0.00015,
    costPer1kCompletion: 0.0006,
    tier: "free",
  },
  {
    id: "gpt-4o",
    provider: "openai",
    displayName: "GPT-4o",
    contextWindow: 128_000,
    costPer1kPrompt: 0.0025,
    costPer1kCompletion: 0.01,
    tier: "pro",
  },
  {
    id: "gpt-4.1-mini",
    provider: "openai",
    displayName: "GPT-4.1 Mini",
    contextWindow: 1_000_000,
    costPer1kPrompt: 0.0004,
    costPer1kCompletion: 0.0016,
    tier: "free",
  },
  // OpenRouter models (accessible when OPENROUTER_API_KEY is set)
  {
    id: "openai/gpt-4o-mini",
    provider: "openrouter",
    displayName: "GPT-4o Mini (via OpenRouter)",
    contextWindow: 128_000,
    costPer1kPrompt: 0.00015,
    costPer1kCompletion: 0.0006,
    tier: "pro",
  },
  {
    id: "anthropic/claude-3-haiku",
    provider: "openrouter",
    displayName: "Claude 3 Haiku (via OpenRouter)",
    contextWindow: 200_000,
    costPer1kPrompt: 0.00025,
    costPer1kCompletion: 0.00125,
    tier: "pro",
  },
]

/**
 * Estimate cost in USD for a given usage.
 */
export function estimateCost(
  modelId: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const model = MODELS.find((m) => m.id === modelId)
  if (!model) return 0
  return (
    (promptTokens / 1000) * model.costPer1kPrompt +
    (completionTokens / 1000) * model.costPer1kCompletion
  )
}

/**
 * Get models available for a given user tier.
 */
export function getModelsForTier(tier: "free" | "pro" | "admin"): ModelDefinition[] {
  if (tier === "admin") return MODELS
  if (tier === "pro") return MODELS
  return MODELS.filter((m) => m.tier === "free")
}

/**
 * Find a model definition by ID.
 */
export function getModelDef(modelId: string): ModelDefinition | undefined {
  return MODELS.find((m) => m.id === modelId)
}
