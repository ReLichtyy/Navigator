/**
 * guardrails/index.ts — Guardrails pipeline entry point.
 *
 * Re-exports the input/output validators and provides a combined pipeline
 * for use in route handlers.
 */

export { validateInput } from "./input"
export { validateOutput } from "./output"
export type { GuardrailResult, GuardrailRule } from "./types"
