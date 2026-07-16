/**
 * agents/verafalso.ts — V/F justificado exercise generator. Produces
 * true/false statements about the subject, each with a one-line justification.
 * Emitted into the quiz bank with `kind: "vf"` and Verdadero/Falso options, so
 * it renders through the standard choice view but reads as a true/false item.
 */
import { z } from "zod"
import { runAgent } from "./_base"
import {
  buildDirectives,
  SUBJECT_GROUNDING_POLICY,
  type QuizQuestion,
  type StudyGenOptions,
} from "../study-gen"

const Schema = z.object({
  items: z.array(
    z.object({
      statement: z.string(),
      isTrue: z.boolean(),
      why: z.string(),
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
        description: `EXACTLY ${count} true/false statements, spread across the course's topics. Mix true and false.`,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            statement: {
              type: "string",
              description:
                "A single, unambiguous claim about the subject that is clearly true OR clearly false.",
            },
            isTrue: { type: "boolean", description: "Whether the statement is true" },
            why: {
              type: "string",
              description: "One short line justifying the verdict (the grounded reason).",
            },
            topic: { type: "string", description: "The topic this assesses" },
            cite: {
              type: "string",
              description: "The subject topic/section it draws from (a concept label, never a fake page).",
            },
            improve: { type: "string", description: "One line: what to reinforce if missed." },
          },
          required: ["statement", "isTrue", "why", "topic", "cite", "improve"],
        },
      },
    },
    required: ["items"],
  }
}

const SYSTEM =
  "You are the true/false-exercise agent for a university course. " +
  `${SUBJECT_GROUNDING_POLICY} RULES: (1) Each statement is a single, unambiguous claim that is clearly ` +
  "true or clearly false — no trick wording, no double negatives. (2) Roughly balance true and false across " +
  "the set. (3) Ground every statement in real subject content, never document metadata. (4) `why` is one " +
  "short grounded line explaining the verdict."

const VERDADERO = "Verdadero"
const FALSO = "Falso"

export async function verafalsoAgent(
  evidence: string,
  opts: StudyGenOptions = {},
  count = 3,
): Promise<QuizQuestion[]> {
  const out = await runAgent({
    role: "inquisitor",
    system: SYSTEM,
    user: `${buildDirectives(opts)}\n\nCourse material:\n\n${evidence}`,
    schema: Schema,
    jsonSchema: jsonSchema(count),
    schemaName: "verafalso",
  })
  if (!out) return []
  return out.items
    .map((it): QuizQuestion | null => {
      const statement = it.statement.trim()
      const why = it.why.trim()
      if (statement.length === 0) return null
      const answer = it.isTrue ? 0 : 1 // 0 = Verdadero, 1 = Falso
      const wrongIdx = it.isTrue ? 1 : 0
      const topic = it.topic?.trim()
      const cite = it.cite?.trim()
      const improve = it.improve?.trim()
      return {
        question: statement,
        options: [VERDADERO, FALSO],
        answer,
        explanation: why,
        kind: "vf",
        ...(why ? { whyYes: [why] } : {}),
        ...(why ? { whyNo: { [String(wrongIdx)]: [`La afirmación es ${it.isTrue ? "verdadera" : "falsa"}: ${why}`] } } : {}),
        ...(topic ? { topic } : {}),
        ...(cite ? { cite } : {}),
        ...(improve ? { improve } : {}),
      }
    })
    .filter((q): q is QuizQuestion => q !== null)
}
