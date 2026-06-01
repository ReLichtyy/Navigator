/**
 * guardrails/input.ts — Pre-LLM input validation rules.
 *
 * Runs BEFORE the user's message reaches the LLM provider.
 * Blocks prompt injection, overly long messages, and empty content.
 */

import type { GuardrailRule, GuardrailResult } from "./types"

const MAX_INPUT_LENGTH = 4000

// Common prompt injection patterns (case-insensitive).
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /you\s+are\s+now\s+(?:DAN|evil|jailbroken)/i,
  /\bsystem\s*:\s*/i,
  /\[INST\]/i,
  /<<\s*SYS\s*>>/i,
  /\bdo\s+anything\s+now\b/i,
  /pretend\s+(?:you|to\s+be)\s+(?:a|an)\s+(?!student|teacher)/i,
]

// ── Individual Rules ─────────────────────────────────────────────────────────

const emptyCheck: GuardrailRule = {
  name: "input:empty",
  check: (text) => {
    const trimmed = text.trim()
    if (!trimmed) {
      return { passed: false, rule: "input:empty", reason: "Message cannot be empty." }
    }
    return { passed: true }
  },
}

const lengthCheck: GuardrailRule = {
  name: "input:length",
  check: (text) => {
    if (text.length > MAX_INPUT_LENGTH) {
      return {
        passed: false,
        rule: "input:length",
        reason: `Message too long (${text.length} chars). Maximum is ${MAX_INPUT_LENGTH}.`,
      }
    }
    return { passed: true }
  },
}

const injectionCheck: GuardrailRule = {
  name: "input:injection",
  check: (text) => {
    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(text)) {
        return {
          passed: false,
          rule: "input:injection",
          reason: "Message contains disallowed instructions.",
        }
      }
    }
    return { passed: true }
  },
}

// ── Exported Rules Array ─────────────────────────────────────────────────────

export const INPUT_RULES: GuardrailRule[] = [
  emptyCheck,
  lengthCheck,
  injectionCheck,
]

/**
 * Run all input guardrails. Returns the first failure, or passed=true.
 */
export function validateInput(text: string): GuardrailResult {
  for (const rule of INPUT_RULES) {
    const result = rule.check(text)
    if (!result.passed) return result
  }
  return { passed: true }
}
