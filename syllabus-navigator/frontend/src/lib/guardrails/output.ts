/**
 * guardrails/output.ts — Post-LLM output validation rules.
 *
 * Runs AFTER the LLM responds, BEFORE the response reaches the client.
 * Strips HTML, caps length, and flags problematic patterns.
 */

import type { GuardrailRule, GuardrailResult } from "./types"

const MAX_OUTPUT_LENGTH = 8000

// ── Individual Rules ─────────────────────────────────────────────────────────

const htmlStrip: GuardrailRule = {
  name: "output:html",
  check: (text) => {
    // Check for HTML tags (not markdown code blocks)
    const hasHtml = /<(?!code|pre)[a-z][\s\S]*?>/i.test(text)
    if (hasHtml) {
      const sanitized = text
        .replace(/<[^>]*>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .trim()
      return {
        passed: true, // Don't block, just sanitize
        sanitized,
      }
    }
    return { passed: true }
  },
}

const lengthCap: GuardrailRule = {
  name: "output:length",
  check: (text) => {
    if (text.length > MAX_OUTPUT_LENGTH) {
      return {
        passed: true, // Don't block, truncate
        sanitized: text.slice(0, MAX_OUTPUT_LENGTH) + "\n\n[Response truncated]",
      }
    }
    return { passed: true }
  },
}

const errorDetection: GuardrailRule = {
  name: "output:error_content",
  check: (text) => {
    // Detect when LLM returns raw error JSON or stack traces
    const errorPatterns = [
      /^{"error":/,
      /^{"message":"Internal Server Error"/,
      /Traceback \(most recent call last\)/,
      /^<!DOCTYPE html>/i,
    ]
    for (const pattern of errorPatterns) {
      if (pattern.test(text.trim())) {
        return {
          passed: false,
          rule: "output:error_content",
          reason: "The AI returned an error instead of a response. Please try again.",
          sanitized: "Lo siento, ocurrió un error al procesar tu pregunta. Intenta de nuevo.",
        }
      }
    }
    return { passed: true }
  },
}

// ── Exported Rules Array ─────────────────────────────────────────────────────

export const OUTPUT_RULES: GuardrailRule[] = [errorDetection, htmlStrip, lengthCap]

/**
 * Run all output guardrails. Applies sanitization cumulatively.
 * If any rule fails hard, returns the failure. Otherwise returns
 * the (possibly sanitized) text.
 */
export function validateOutput(text: string): GuardrailResult {
  let current = text

  for (const rule of OUTPUT_RULES) {
    const result = rule.check(current)
    if (!result.passed) return result
    if (result.sanitized) current = result.sanitized
  }

  return { passed: true, sanitized: current !== text ? current : undefined }
}
