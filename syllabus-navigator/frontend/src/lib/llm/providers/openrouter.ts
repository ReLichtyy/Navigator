/**
 * llm/providers/openrouter.ts — OpenRouter provider adapter.
 *
 * Uses the OpenAI SDK with a custom baseURL pointing to OpenRouter's
 * OpenAI-compatible endpoint. Reads OPENROUTER_API_KEY from env.
 *
 * Supports models like "openai/gpt-4o-mini", "anthropic/claude-3-haiku", etc.
 */

import OpenAI from "openai"
import type { LLMProviderAdapter, LLMMessage, LLMConfig, LLMResponse } from "../types"
import { logError } from "@/lib/observability/logger"

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

let _client: OpenAI | null = null

function getClient(): OpenAI {
  if (!_client) {
    const apiKey = process.env.OPENROUTER_API_KEY
    if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured")
    _client = new OpenAI({
      apiKey,
      baseURL: OPENROUTER_BASE_URL,
      defaultHeaders: {
        "HTTP-Referer": process.env.NEXTAUTH_URL ?? "http://localhost:3000",
        "X-Title": "Navigator",
      },
    })
  }
  return _client
}

/** Shared client accessor for the tool-calling loop (lib/llm/tools-loop.ts). */
export function getOpenRouterClient(): OpenAI {
  return getClient()
}

export const openrouterProvider: LLMProviderAdapter = {
  name: "openrouter",

  isConfigured(): boolean {
    return Boolean(process.env.OPENROUTER_API_KEY)
  },

  async chat(messages: LLMMessage[], config: LLMConfig): Promise<LLMResponse> {
    const client = getClient()

    try {
      const completion = await client.chat.completions.create({
        model: config.model,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        temperature: config.temperature ?? 0.2,
        max_tokens: config.maxTokens,
      })

      const choice = completion.choices[0]
      const content = choice?.message?.content ?? ""
      const usage = completion.usage

      return {
        content,
        model: completion.model,
        provider: "openrouter",
        usage: {
          promptTokens: usage?.prompt_tokens ?? 0,
          completionTokens: usage?.completion_tokens ?? 0,
          totalTokens: usage?.total_tokens ?? 0,
        },
      }
    } catch (err) {
      logError("llm.openrouter.error", {
        model: config.model,
        error: err instanceof Error ? err.message : String(err),
        statusCode: (err as { status?: number })?.status,
      })
      throw err
    }
  },
  async *chatStream(messages: LLMMessage[], config: LLMConfig) {
    const client = getClient()

    try {
      const stream = await client.chat.completions.create({
        model: config.model,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        temperature: config.temperature ?? 0.2,
        max_tokens: config.maxTokens,
        stream: true,
        stream_options: { include_usage: true },
      })

      for await (const chunk of stream) {
        if (chunk.usage) {
          yield {
            type: "finish",
            usage: {
              promptTokens: chunk.usage.prompt_tokens ?? 0,
              completionTokens: chunk.usage.completion_tokens ?? 0,
              totalTokens: chunk.usage.total_tokens ?? 0,
            },
            model: chunk.model,
            provider: "openrouter",
          }
        } else {
          const content = chunk.choices[0]?.delta?.content
          if (content) {
            yield { type: "text", content }
          }
        }
      }
    } catch (err) {
      logError("llm.openrouter.stream_error", {
        model: config.model,
        error: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  },
}
