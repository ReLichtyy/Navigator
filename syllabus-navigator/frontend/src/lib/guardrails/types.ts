/**
 * guardrails/types.ts — Shared types for input/output validation.
 */

export interface GuardrailResult {
  /** Whether the content passed validation. */
  passed: boolean
  /** If blocked, the rule that triggered it. */
  rule?: string
  /** Human-readable reason for blocking. */
  reason?: string
  /** Cleaned version of the content (if applicable). */
  sanitized?: string
}

export interface GuardrailRule {
  /** Unique rule identifier. */
  name: string
  /** Run the check. Return passed=false to block. */
  check: (text: string) => GuardrailResult
}
