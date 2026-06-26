/**
 * agents/critic.ts — the quiz Critic (the "big upgrade" gate).
 *
 * Supersedes the correctness-only verifier: for each question it judges THREE
 * axes against the source material, so shallow-but-correct questions die too:
 *   - sound:       exactly one option is correct AND the marked index is it,
 *   - grounded:    the question hinges on a specific passage/fact in the material
 *                  (not answerable from general knowledge without reading it),
 *   - substantive: it tests understanding/application, not trivia/filler.
 * Runs (ideally) on a different model family than the inquisitor — set
 * MODEL_VERIFIER to an OpenRouter id for cross-family review.
 */
import { z } from "zod"
import { runAgent } from "./_base"
import type { QuizQuestion, Flashcard } from "../study-gen"

const Schema = z.object({
  sound: z.boolean(),
  grounded: z.boolean(),
  substantive: z.boolean(),
  correctIndex: z.number(),
  reason: z.string(),
})

const JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    sound: {
      type: "boolean",
      description: "true when exactly one option is correct per the material AND the marked answer index is that option",
    },
    grounded: {
      type: "boolean",
      description:
        "true when answering REQUIRES the material — the question is anchored to a specific fact, definition, value, mechanism or example present in the text. false if it is answerable from general knowledge.",
    },
    substantive: {
      type: "boolean",
      description:
        "true when the question tests real understanding/application; false for trivia, tautologies, or filler (e.g. 'what is the title of the course').",
    },
    correctIndex: { type: "number", description: "0-based index of the option that is actually correct" },
    reason: { type: "string", description: "Short justification, naming the axis that failed if any" },
  },
  required: ["sound", "grounded", "substantive", "correctIndex", "reason"],
} as const

const SYSTEM =
  "You are a strict exam-question critic. Given the source material and a multiple-choice question, " +
  "judge it on three axes: (1) sound — exactly one option is correct per the material and the marked " +
  "answer is that option; (2) grounded — answering it genuinely requires having read THIS material " +
  "(it hinges on a specific fact, definition, value, mechanism or example in the text), not general " +
  "knowledge; (3) substantive — it tests understanding/application, not trivia or filler. Be skeptical: " +
  "when in doubt on an axis, mark it false. Always return the index you believe is actually correct."

export interface Critique {
  sound: boolean
  grounded: boolean
  substantive: boolean
  correctIndex: number
  reason: string
}

export async function critiqueQuestion(
  q: QuizQuestion,
  evidence: string,
): Promise<Critique | null> {
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
    schemaName: "critique",
    temperature: 0,
  })
}

// ── Flashcard critic ─────────────────────────────────────────────────────────

const CardSchema = z.object({
  accurate: z.boolean(),
  grounded: z.boolean(),
  substantive: z.boolean(),
  reason: z.string(),
})

const CARD_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    accurate: {
      type: "boolean",
      description: "true when the back correctly defines/answers the front per the material (no errors)",
    },
    grounded: {
      type: "boolean",
      description: "true when both sides are anchored to the material — not generic outside knowledge",
    },
    substantive: {
      type: "boolean",
      description: "true when the card teaches something worth knowing; false for trivia/filler/tautologies",
    },
    reason: { type: "string", description: "Short justification, naming the axis that failed if any" },
  },
  required: ["accurate", "grounded", "substantive", "reason"],
} as const

const CARD_SYSTEM =
  "You are a strict flashcard critic. Given the source material and a concept→definition (or cloze) " +
  "card, judge three axes: (1) accurate — the back correctly defines/answers the front according to " +
  "the material, with no factual error; (2) grounded — both sides come from THIS material, not generic " +
  "outside knowledge; (3) substantive — it teaches something worth knowing, not trivia or a tautology. " +
  "Be skeptical: when in doubt on an axis, mark it false."

export interface CardCritique {
  accurate: boolean
  grounded: boolean
  substantive: boolean
  reason: string
}

export async function critiqueFlashcard(
  card: Flashcard,
  evidence: string,
): Promise<CardCritique | null> {
  const user =
    `Material (evidence):\n${evidence.slice(0, 6_000)}\n\n` +
    `Flashcard front: ${card.front}\nFlashcard back: ${card.back}`
  return runAgent({
    role: "verifier",
    system: CARD_SYSTEM,
    user,
    schema: CardSchema,
    jsonSchema: CARD_JSON_SCHEMA as unknown as Record<string, unknown>,
    schemaName: "card_critique",
    temperature: 0,
  })
}
