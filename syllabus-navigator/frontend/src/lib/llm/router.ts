/**
 * llm/router.ts — Model routing engine.
 *
 * P0: Simple rule-based routing.
 * P1: Context-aware routing (message complexity, cost optimization).
 */

import type { LLMProvider } from "./types"
import { DEFAULT_MODEL, DEFAULT_PROVIDER, getModelDef, MODELS } from "./config"
import { openaiProvider } from "./providers/openai"
import { openrouterProvider } from "./providers/openrouter"
import { logWarn } from "@/lib/observability/logger"

export interface RoutingContext {
  userTier: "guest" | "free" | "pro" | "admin"
  preferredProvider?: LLMProvider
  preferredModel?: string
  messageLength?: number
}

export interface RoutingDecision {
  provider: LLMProvider
  model: string
  reason: string
}

/**
 * Select the best provider + model for a given context.
 *
 * Rules (in priority order):
 * 1. If user has a preference AND has access → use it
 * 2. If preferred provider isn't configured → fallback
 * 3. Free tier → always gpt-4o-mini via OpenAI
 * 4. Unknown provider → fallback to OpenAI default
 */
export function selectModel(ctx: RoutingContext): RoutingDecision {
  // User preference takes priority
  if (ctx.preferredModel && ctx.preferredProvider) {
    const modelDef = getModelDef(ctx.preferredModel)

    // Check tier access
    if (
      modelDef &&
      modelDef.tier === "pro" &&
      (ctx.userTier === "free" || ctx.userTier === "guest")
    ) {
      return {
        provider: DEFAULT_PROVIDER,
        model: DEFAULT_MODEL,
        reason: `Model "${ctx.preferredModel}" requires pro tier. Falling back to ${DEFAULT_MODEL}.`,
      }
    }

    // Check if provider is configured
    if (ctx.preferredProvider === "openrouter" && !openrouterProvider.isConfigured()) {
      logWarn("llm.router.fallback", {
        from: "openrouter",
        to: "openai",
        reason: "OPENROUTER_API_KEY not configured",
      })
      return {
        provider: "openai",
        model: DEFAULT_MODEL,
        reason: "OpenRouter not configured. Falling back to OpenAI.",
      }
    }

    if (ctx.preferredProvider === "openai" && !openaiProvider.isConfigured()) {
      logWarn("llm.router.fallback", {
        from: "openai",
        to: "openrouter",
        reason: "OPENAI_API_KEY not configured",
      })
      // Try openrouter as fallback
      if (openrouterProvider.isConfigured()) {
        return {
          provider: "openrouter",
          model: `openai/${DEFAULT_MODEL}`,
          reason: "OpenAI not configured. Falling back to OpenRouter.",
        }
      }
    }

    return {
      provider: ctx.preferredProvider,
      model: ctx.preferredModel,
      reason: "User preference",
    }
  }

  // User has only a model preference (no provider specified)
  if (ctx.preferredModel) {
    const modelDef = getModelDef(ctx.preferredModel)
    if (modelDef) {
      const provider = modelDef.provider
      if (provider === "openai" && openaiProvider.isConfigured()) {
        return { provider: "openai", model: ctx.preferredModel, reason: "User model preference" }
      }
      if (provider === "openrouter" && openrouterProvider.isConfigured()) {
        return {
          provider: "openrouter",
          model: ctx.preferredModel,
          reason: "User model preference",
        }
      }
    }
  }

  // Default routing
  if (openaiProvider.isConfigured()) {
    return { provider: "openai", model: DEFAULT_MODEL, reason: "Default (OpenAI)" }
  }

  if (openrouterProvider.isConfigured()) {
    return {
      provider: "openrouter",
      model: `openai/${DEFAULT_MODEL}`,
      reason: "Default fallback (OpenRouter)",
    }
  }

  // No provider configured at all
  return {
    provider: "openai",
    model: DEFAULT_MODEL,
    reason: "No LLM provider configured — calls will fail",
  }
}

/**
 * Get available models for display in the UI.
 */
export function getAvailableModels(userTier: "guest" | "free" | "pro" | "admin"): string[] {
  const available: string[] = []

  for (const model of MODELS) {
    // Tier check
    if (model.tier === "pro" && (userTier === "free" || userTier === "guest")) continue

    // Provider availability check
    if (model.provider === "openai" && !openaiProvider.isConfigured()) continue
    if (model.provider === "openrouter" && !openrouterProvider.isConfigured()) continue

    available.push(model.id)
  }

  return available.length > 0 ? available : [DEFAULT_MODEL]
}
