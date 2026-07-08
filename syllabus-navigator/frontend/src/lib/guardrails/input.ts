/**
 * guardrails/input.ts — Pre-LLM input validation rules.
 *
 * Runs BEFORE the user's message reaches the LLM provider.
 * Blocks prompt injection, overly long messages, and empty content.
 */

import type { GuardrailRule, GuardrailResult } from "./types"

const MAX_INPUT_LENGTH = 4000

// Common prompt injection patterns (case-insensitive), English + Spanish.
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /ignora\s+(todas\s+)?(las\s+|tus\s+)?instrucciones(\s+(anteriores|previas))?/i,
  /olvida\s+(todas\s+)?(tus|las)\s+(instrucciones|reglas)/i,
  /you\s+are\s+now\s+(?:DAN|evil|jailbroken)/i,
  /\beres\s+DAN\b/i,
  /act(?:úa|ua)\s+como\s+si\s+no\s+tuvieras\s+(reglas|restricciones|filtros)/i,
  /\bsystem\s*:\s*/i,
  /\[INST\]/i,
  /<<\s*SYS\s*>>/i,
  /<\|im_start\|>/i,
  /\bdo\s+anything\s+now\b/i,
  /pretend\s+(?:you|to\s+be)\s+(?:a|an)\s+(?!student|teacher)/i,
  // System-prompt extraction attempts (EN/ES) — verb near "system prompt".
  /(reveal|print|show|repeat|output|leak)[\s\S]{0,40}(system\s*prompt|hidden\s+instructions|initial\s+instructions)/i,
  /(revela|muestra|imprime|repite|escribe|dime)[\s\S]{0,40}(system\s*prompt|prompt\s+del\s+sistema|instrucciones\s+(del\s+sistema|iniciales|originales|ocultas))/i,
]

// Raw control characters (except \n, \r, \t) are never legitimate chat input and
// are a common smuggling vector for invisible-instruction attacks.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = new RegExp("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]")

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

const controlCharCheck: GuardrailRule = {
  name: "input:control_chars",
  check: (text) => {
    if (CONTROL_CHARS.test(text)) {
      return {
        passed: false,
        rule: "input:control_chars",
        reason: "Message contains invalid characters.",
      }
    }
    return { passed: true }
  },
}

// ── Exported Rules Array ─────────────────────────────────────────────────────

export const INPUT_RULES: GuardrailRule[] = [
  emptyCheck,
  lengthCheck,
  controlCharCheck,
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
