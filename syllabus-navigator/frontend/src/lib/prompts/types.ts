/**
 * prompts/types.ts — Prompt template type definitions.
 */

export interface PromptTemplate {
  /** Unique identifier, e.g. "chat:general" */
  id: string
  /** Version number — increment on breaking changes */
  version: number
  /** System message template. Use {{variable}} for interpolation. */
  system: string
  /** Optional user message wrapper template. */
  userTemplate?: string
  /** Expected variable names in templates. */
  variables: string[]
  /** Descriptive metadata. */
  metadata: {
    description: string
    tags: string[]
  }
}

export interface CompiledPrompt {
  system: string
  userMessage?: string
}
