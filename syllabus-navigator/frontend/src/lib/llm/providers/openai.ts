/**
 * llm/providers/openai.ts — OpenAI provider adapter.
 *
 * Uses the official openai npm package. Reads OPENAI_API_KEY from env.
 * Default model: gpt-4o-mini.
 */

import OpenAI from "openai"
import type { LLMProviderAdapter, LLMMessage, LLMConfig, LLMResponse } from "../types"
import { logError } from "@/lib/observability/logger"

let _client: OpenAI | null = null

function getClient(): OpenAI {
  if (!_client) {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) throw new Error("OPENAI_API_KEY is not configured")
    _client = new OpenAI({ apiKey })
  }
  return _client
}

export const openaiProvider: LLMProviderAdapter = {
  name: "openai",

  isConfigured(): boolean {
    return Boolean(process.env.OPENAI_API_KEY)
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
        provider: "openai",
        usage: {
          promptTokens: usage?.prompt_tokens ?? 0,
          completionTokens: usage?.completion_tokens ?? 0,
          totalTokens: usage?.total_tokens ?? 0,
        },
      }
    } catch (err) {
      logError("llm.openai.error", {
        model: config.model,
        error: err instanceof Error ? err.message : String(err),
        statusCode: (err as { status?: number })?.status,
      })
      throw err
    }
  },
}
