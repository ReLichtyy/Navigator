/**
 * agents/verifier.ts — Critic agent. Validates a quiz question against the
 * evidence: is exactly one option correct, is the marked answer right, are the
 * distractors unambiguous? Should run on a DIFFERENT model family than the
 * generator (cross-family verification) — set MODEL_VERIFIER accordingly.
 */
import { z } from "zod"
import { runAgent } from "./_base"
import type { QuizQuestion } from "../study-gen"

const Schema = z.object({
  ok: z.boolean(),
  correctIndex: z.number(),
  reason: z.string(),
})

const JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    ok: { type: "boolean", description: "true when the question is sound AND the marked answer is correct" },
    correctIndex: { type: "number", description: "0-based index of the option that is actually correct" },
    reason: { type: "string", description: "Short justification" },
  },
  required: ["ok", "correctIndex", "reason"],
} as const

const SYSTEM =
  "You are a strict exam-question reviewer. Given the source material and a multiple-choice question, " +
  "check: (1) exactly one option is correct per the material, (2) the marked answer index is that " +
  "correct option, (3) distractors are wrong and unambiguous. Be skeptical: if anything is off, " +
  "return ok=false. Always return the index you believe is actually correct."

export interface Verdict {
  ok: boolean
  correctIndex: number
  reason: string
}

export async function verifyQuestion(q: QuizQuestion, evidence: string): Promise<Verdict | null> {
  const optionsList = q.options.map((o, i) => `${i}. ${o}`).join("\n")
  const user =
    `Material (evidence):\n${evidence.slice(0, 6_000)}\n\n` +
    `Question: ${q.question}\nOptions:\n${optionsList}\nMarked answer index: ${q.answer}`
  return runAgent({
    role: "verifier",
    system: SYSTEM,
    user,
    schema: Schema,
    jsonSchema: JSON_SCHEMA as unknown as Record<string, unknown>,
    schemaName: "verdict",
    temperature: 0,
  })
}
