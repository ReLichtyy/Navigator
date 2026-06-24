/**
 * llm/types.ts — Shared types for the LLM provider abstraction.
 */

export type LLMProvider = "openai" | "openrouter"

export interface LLMMessage {
  role: "system" | "user" | "assistant"
  content: string
}

export interface LLMConfig {
  provider: LLMProvider
  model: string
  temperature?: number
  maxTokens?: number
}

export interface LLMResponse {
  content: string
  model: string
  provider: LLMProvider
  usage: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

export type LLMStreamChunk =
  | {
      type: "text"
      content: string
    }
  | {
      type: "finish"
      usage: {
        promptTokens: number
        completionTokens: number
        totalTokens: number
      }
      model: string
      provider: LLMProvider
    }

export interface LLMProviderAdapter {
  readonly name: LLMProvider
  chat(messages: LLMMessage[], config: LLMConfig): Promise<LLMResponse>
  chatStream?(
    messages: LLMMessage[],
    config: LLMConfig,
  ): AsyncGenerator<LLMStreamChunk, void, unknown>
  isConfigured(): boolean
}
