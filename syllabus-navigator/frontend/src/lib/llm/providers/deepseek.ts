/**
 * llm/providers/deepseek.ts — DeepSeek provider adapter.
 *
 * DeepSeek exposes an OpenAI-compatible API, so we reuse the OpenAI SDK with a
 * custom baseURL. Reads DEEPSEEK_API_KEY from env. Used as the default chat
 * provider (the user-facing model "GPT-5.5" maps to deepseek-v4-pro).
 *
 * Note: embeddings still go through OpenAI (DeepSeek has no embeddings endpoint),
 * so OPENAI_API_KEY must stay configured for the RAG pipeline.
 */

import OpenAI from "openai"
import type { LLMProviderAdapter, LLMMessage, LLMConfig, LLMResponse } from "../types"
import { logError } from "@/lib/observability/logger"

const DEEPSEEK_BASE_URL = "https://api.deepseek.com"

let _client: OpenAI | null = null

function getClient(): OpenAI {
  if (!_client) {
    const apiKey = process.env.DEEPSEEK_API_KEY
    if (!apiKey) throw new Error("DEEPSEEK_API_KEY is not configured")
    _client = new OpenAI({ apiKey, baseURL: DEEPSEEK_BASE_URL })
  }
  return _client
}

/** Shared client accessor for the tool-calling loop (lib/llm/tools-loop.ts). */
export function getDeepSeekClient(): OpenAI {
  return getClient()
}

export const deepseekProvider: LLMProviderAdapter = {
  name: "deepseek",

  isConfigured(): boolean {
    return Boolean(process.env.DEEPSEEK_API_KEY)
  },

  async chat(messages: LLMMessage[], config: LLMConfig): Promise<LLMResponse> {
    const client = getClient()

    try {
      const completion = await client.chat.completions.create({
        model: config.model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        // deepseek-v4-pro is a reasoning model — it ignores sampling params and
        // spends part of the token budget on hidden reasoning. Omit temperature.
        max_tokens: config.maxTokens,
      })

      const choice = completion.choices[0]
      const content = choice?.message?.content ?? ""
      const usage = completion.usage

      return {
        content,
        model: completion.model,
        provider: "deepseek",
        usage: {
          promptTokens: usage?.prompt_tokens ?? 0,
          completionTokens: usage?.completion_tokens ?? 0,
          totalTokens: usage?.total_tokens ?? 0,
        },
      }
    } catch (err) {
      logError("llm.deepseek.error", {
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
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        // deepseek-v4-pro is a reasoning model — it ignores sampling params and
        // spends part of the token budget on hidden reasoning. Omit temperature.
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
            provider: "deepseek",
          }
        } else {
          const content = chunk.choices[0]?.delta?.content
          if (content) {
            yield { type: "text", content }
          }
        }
      }
    } catch (err) {
      logError("llm.deepseek.stream_error", {
        model: config.model,
        error: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  },
}
