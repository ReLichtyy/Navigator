/**
 * llm/index.ts — LLM provider abstraction entry point.
 *
 * This is the ONLY module that route handlers should call for LLM completions.
 * It dispatches to the appropriate provider, measures latency, and logs usage.
 */

import type { LLMConfig, LLMMessage, LLMProvider, LLMResponse } from "./types"
import { openaiProvider } from "./providers/openai"
import { openrouterProvider } from "./providers/openrouter"
import { DEFAULT_MODEL, DEFAULT_PROVIDER } from "./config"
import { timed } from "@/lib/observability/timing"
import { logError, logInfo, logWarn } from "@/lib/observability/logger"

// ── Provider registry ────────────────────────────────────────────────────────

const providers: Record<LLMProvider, typeof openaiProvider> = {
  openai: openaiProvider,
  openrouter: openrouterProvider,
}

// ── Main entry point ─────────────────────────────────────────────────────────

/**
 * Execute a chat completion through the provider layer.
 *
 * @param messages  Conversation messages (system + history + user)
 * @param config    Provider, model, temperature, etc.
 * @returns         LLM response with content + usage metadata
 *
 * @example
 * const response = await chatCompletion(
 *   [{ role: "system", content: "..." }, { role: "user", content: "Hello" }],
 *   { provider: "openai", model: "gpt-4o-mini" }
 * )
 */
export async function chatCompletion(
  messages: LLMMessage[],
  config?: Partial<LLMConfig>,
): Promise<LLMResponse> {
  const resolvedConfig: LLMConfig = {
    provider: config?.provider ?? DEFAULT_PROVIDER,
    model: config?.model ?? DEFAULT_MODEL,
    temperature: config?.temperature ?? 0.2,
    maxTokens: config?.maxTokens,
  }

  const provider = providers[resolvedConfig.provider]

  // Fallback if provider not found
  if (!provider) {
    logWarn("llm.unknown_provider", {
      requested: resolvedConfig.provider,
      fallback: DEFAULT_PROVIDER,
    })
    resolvedConfig.provider = DEFAULT_PROVIDER
  }

  const activeProvider = providers[resolvedConfig.provider]

  // Check if provider is configured
  if (!activeProvider.isConfigured()) {
    // Try the other provider
    const fallbackName: LLMProvider =
      resolvedConfig.provider === "openai" ? "openrouter" : "openai"
    const fallback = providers[fallbackName]

    if (fallback.isConfigured()) {
      logWarn("llm.fallback", {
        fromProvider: resolvedConfig.provider,
        toProvider: fallbackName,
        reason: `${resolvedConfig.provider} not configured`,
      })
      resolvedConfig.provider = fallbackName
      // Adjust model name if switching between providers
      if (fallbackName === "openrouter" && !resolvedConfig.model.includes("/")) {
        resolvedConfig.model = `openai/${resolvedConfig.model}`
      }
      if (fallbackName === "openai" && resolvedConfig.model.includes("/")) {
        resolvedConfig.model = resolvedConfig.model.split("/").pop() ?? DEFAULT_MODEL
      }
    } else {
      throw new Error(
        "No LLM provider is configured. Set OPENAI_API_KEY or OPENROUTER_API_KEY.",
      )
    }
  }

  const finalProvider = providers[resolvedConfig.provider]

  // Execute with timing
  const { result, ms } = await timed("llm.chat", () =>
    finalProvider.chat(messages, resolvedConfig),
  )

  logInfo("llm.call", {
    provider: resolvedConfig.provider,
    model: resolvedConfig.model,
    latencyMs: ms,
    promptTokens: result.usage.promptTokens,
    completionTokens: result.usage.completionTokens,
    totalTokens: result.usage.totalTokens,
  })

  return result
}

// Re-export types and utilities
export type { LLMConfig, LLMMessage, LLMProvider, LLMResponse } from "./types"
export { DEFAULT_MODEL, DEFAULT_PROVIDER } from "./config"
export { getAvailableModels } from "./router"
export { selectModel } from "./router"
