/**
 * agents/fillblank.ts — "Completar el hueco" exercise generator. Produces a
 * short snippet (code, formula or sentence) with ONE gap the student types.
 * Emitted into the quiz bank with `kind: "fill"`; `fillText` carries the snippet
 * with a `_____` placeholder and `fillAnswers` the accepted completions.
 */
import { z } from "zod"
import { runAgent } from "./_base"
import {
  buildDirectives,
  SUBJECT_GROUNDING_POLICY,
  type QuizQuestion,
  type StudyGenOptions,
} from "../study-gen"

/** The gap marker the UI splits on. */
export const FILL_GAP = "_____"

const Schema = z.object({
  items: z.array(
    z.object({
      question: z.string(),
      text: z.string(),
      answers: z.array(z.string()),
      why: z.string().optional(),
      topic: z.string().optional(),
      cite: z.string().optional(),
      improve: z.string().optional(),
    }),
  ),
})

function jsonSchema(count: number): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      items: {
        type: "array",
        description: `EXACTLY ${count} fill-in-the-blank exercises, each on a DIFFERENT topic.`,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            question: {
              type: "string",
              description:
                "The instruction, e.g. 'Completa lo que falta en el código' — short, in the output language.",
            },
            text: {
              type: "string",
              description:
                `A short snippet (1–4 lines of code, a formula, or a key sentence) containing EXACTLY ONE gap ` +
                `written as "${FILL_GAP}". The gap must hide a single meaningful term/keyword/expression — ` +
                "not a whole clause.",
            },
            answers: {
              type: "array",
              items: { type: "string" },
              description:
                "1–4 accepted completions for the gap (the canonical one first, then common equivalent " +
                "spellings/synonyms). Short — a term or expression, not a sentence.",
            },
            why: { type: "string", description: "One short line explaining the correct completion." },
            topic: { type: "string", description: "The topic this exercise assesses" },
            cite: {
              type: "string",
              description:
                "The subject topic/section this draws from (a concept label, never a fabricated page number).",
            },
            improve: { type: "string", description: "One line: what to reinforce if the student fails it." },
          },
          required: ["question", "text", "answers", "why", "topic", "cite", "improve"],
        },
      },
    },
    required: ["items"],
  }
}

const SYSTEM =
  "You are the fill-in-the-blank agent: you write 'complete the gap' exercises for a university course. " +
  `${SUBJECT_GROUNDING_POLICY} RULES: (1) Each snippet has EXACTLY ONE gap marked "${FILL_GAP}". ` +
  "(2) The gap hides one meaningful term, keyword or short expression whose value is determined by the " +
  "subject — not filler words. (3) `answers` lists every completion a fair grader would accept (canonical " +
  "first). (4) Keep the snippet minimal: just enough context to make the answer unambiguous. " +
  "(5) Ground everything in subject content, never document metadata."

export async function fillblankAgent(
  evidence: string,
  opts: StudyGenOptions = {},
  count = 2,
): Promise<QuizQuestion[]> {
  const out = await runAgent({
    role: "inquisitor",
    system: SYSTEM,
    user: `${buildDirectives(opts)}\n\nCourse material:\n\n${evidence}`,
    schema: Schema,
    jsonSchema: jsonSchema(count),
    schemaName: "fillblank",
  })
  if (!out) return []
  return out.items
    .map((it): QuizQuestion | null => {
      const text = it.text.trim()
      const answers = it.answers.map((a) => a.trim()).filter(Boolean)
      // Exactly one gap, at least one accepted answer — else the item is unusable.
      if (answers.length === 0 || text.split(FILL_GAP).length !== 2) return null
      const why = it.why?.trim()
      const topic = it.topic?.trim()
      const cite = it.cite?.trim()
      const improve = it.improve?.trim()
      return {
        question: it.question.trim() || "Completa el hueco",
        options: [],
        answer: 0,
        explanation: why ?? "",
        kind: "fill",
        fillText: text,
        fillAnswers: answers,
        ...(why ? { whyYes: [why] } : {}),
        ...(topic ? { topic } : {}),
        ...(cite ? { cite } : {}),
        ...(improve ? { improve } : {}),
      }
    })
    .filter((q): q is QuizQuestion => q !== null)
}
