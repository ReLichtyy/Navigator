/**
 * llm/providers/openai.ts — OpenAI provider adapter.
 *
 * Uses the official openai npm package. Reads OPENAI_API_KEY from env.
 * Default model: gpt-4o-mini.
 */

import OpenAI from "openai"
import type { LLMProviderAdapter, LLMMessage, LLMConfig, LLMResponse } from "../types"
import { isNextGenModel } from "../config"
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

/**
 * GPT-5 family + reasoning (o-series) models changed the chat-completions
 * contract: `max_tokens` is rejected (must be `max_completion_tokens`) and
 * `temperature` only accepts the default (1). Build the param set per family so
 * one provider serves both the old (gpt-4*) and new models. The family test
 * (`isNextGenModel`) is shared with the RAG generators via lib/llm/config.
 */
function buildParams(model: string, config: LLMConfig) {
  if (isNextGenModel(model)) {
    // Omit temperature (only default 1 allowed); rename the token cap.
    return config.maxTokens ? { max_completion_tokens: config.maxTokens } : {}
  }
  return {
    temperature: config.temperature ?? 0.2,
    ...(config.maxTokens ? { max_tokens: config.maxTokens } : {}),
  }
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
        ...buildParams(config.model, config),
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
  async *chatStream(messages: LLMMessage[], config: LLMConfig) {
    const client = getClient()

    try {
      const stream = await client.chat.completions.create({
        model: config.model,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        ...buildParams(config.model, config),
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
            provider: "openai",
          }
        } else {
          const content = chunk.choices[0]?.delta?.content
          if (content) {
            yield { type: "text", content }
          }
        }
      }
    } catch (err) {
      logError("llm.openai.stream_error", {
        model: config.model,
        error: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  },
}
