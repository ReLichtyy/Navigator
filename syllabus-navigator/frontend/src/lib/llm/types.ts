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

export interface LLMProviderAdapter {
  readonly name: LLMProvider
  chat(messages: LLMMessage[], config: LLMConfig): Promise<LLMResponse>
  isConfigured(): boolean
}
