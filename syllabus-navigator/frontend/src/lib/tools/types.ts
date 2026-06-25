/**
 * tools/types.ts — Shared types for the Actions & Tools layer.
 *
 * A "tool" is a typed, side-effect-aware capability the LLM (or a service)
 * can invoke during orchestration: retrieve syllabus context, read the
 * cronograma, generate a study set, etc. Each tool declares a JSON Schema
 * for its parameters so it can be surfaced to an OpenAI/OpenRouter
 * tool-calling loop without bespoke glue.
 *
 * SCAFFOLD: interfaces are stable; concrete tools live in `./tools/*`.
 */

/** JSON Schema fragment describing a tool's parameters (OpenAI-compatible). */
export interface ToolParameterSchema {
  type: "object"
  properties: Record<string, unknown>
  required?: string[]
  additionalProperties?: boolean
}

/**
 * Per-invocation context handed to every tool. Carries identity + request
 * scope so tools can enforce ownership and stay multi-tenant safe.
 */
export interface ToolContext {
  /** Authenticated user id (or guest id). */
  userId: string
  /** Optional syllabus the conversation is scoped to. */
  syllabusId?: string
  /** Optional chat id, for tools that read/write conversation state. */
  chatId?: string
  /** Trace id for observability correlation. */
  traceId?: string
}

/** Normalized result returned by every tool execution. */
export interface ToolResult<T = unknown> {
  /** Whether the tool ran successfully. */
  ok: boolean
  /** Structured payload to feed back into the model / caller. */
  data?: T
  /** Human-readable error when `ok` is false. */
  error?: string
}

/**
 * A single invokable tool. `parameters` is JSON Schema; `execute` receives
 * the already-parsed args plus the request context.
 */
export interface Tool<TArgs = Record<string, unknown>, TData = unknown> {
  /** Unique, stable tool name (snake_case; used as the tool-call name). */
  name: string
  /** Short description the model uses to decide when to call it. */
  description: string
  /** JSON Schema for the arguments object. */
  parameters: ToolParameterSchema
  /** Run the tool. Should never throw — return a failed ToolResult instead. */
  execute: (args: TArgs, ctx: ToolContext) => Promise<ToolResult<TData>>
}

/** OpenAI-style tool definition (what we send in `tools: [...]`). */
export interface OpenAIToolDef {
  type: "function"
  function: {
    name: string
    description: string
    parameters: ToolParameterSchema
  }
}
