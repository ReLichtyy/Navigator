/**
 * prompts/index.ts — Prompt template resolution and interpolation.
 */

import type { CompiledPrompt, PromptTemplate } from "./types"
import { PROMPT_TEMPLATES } from "./templates"

/**
 * Interpolate {{variable}} placeholders in a template string.
 */
function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? `{{${key}}}`)
}

/**
 * Get a compiled prompt by ID, with variable interpolation.
 *
 * @param id    Template ID (e.g. "chat:general")
 * @param vars  Variables to interpolate into the template
 * @returns     Compiled system + optional user message
 * @throws      Error if template not found
 *
 * @example
 * const prompt = getPrompt("chat:title-gen", { question: "What are the topics?" })
 * // prompt.system = "Generate a concise 4-6 word title..."
 * // prompt.userMessage = "What are the topics?"
 */
export function getPrompt(id: string, vars?: Record<string, string>): CompiledPrompt {
  const template = PROMPT_TEMPLATES[id]
  if (!template) {
    throw new Error(`Prompt template "${id}" not found`)
  }

  const resolvedVars = vars ?? {}

  return {
    system: interpolate(template.system, resolvedVars),
    userMessage: template.userTemplate
      ? interpolate(template.userTemplate, resolvedVars)
      : undefined,
  }
}

/**
 * List all registered prompt templates (for admin/debugging).
 */
export function listPrompts(): PromptTemplate[] {
  return Object.values(PROMPT_TEMPLATES)
}

/**
 * Get a template by ID without compiling it.
 */
export function getTemplate(id: string): PromptTemplate | undefined {
  return PROMPT_TEMPLATES[id]
}

// Re-export types
export type { CompiledPrompt, PromptTemplate } from "./types"
