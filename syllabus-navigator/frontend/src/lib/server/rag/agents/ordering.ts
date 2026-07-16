/**
 * agents/ordering.ts — "Ordenar pasos" exercise generator. Produces a short
 * procedure/sequence of the subject (an algorithm, a proof outline, a workflow)
 * whose steps the student must arrange. Emitted into the quiz bank with
 * `kind: "order"`; `steps` is stored in the CORRECT order and the UI shuffles
 * for display.
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
      question: z.string(),
      steps: z.array(z.string()),
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
        description: `EXACTLY ${count} ordering exercises, each on a DIFFERENT topic of the course.`,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            question: {
              type: "string",
              description:
                "The instruction naming the procedure, e.g. 'Ordena los pasos de una transacción segura' — short, in the output language.",
            },
            steps: {
              type: "array",
              items: { type: "string" },
              description:
                "3–5 steps IN THE CORRECT ORDER. Each step is one short line. The order must be strictly " +
                "determined by the subject (causal/procedural) — never arbitrary or interchangeable.",
            },
            why: {
              type: "string",
              description: "One short line explaining why this order is the correct one.",
            },
            topic: { type: "string", description: "The topic this exercise assesses" },
            cite: {
              type: "string",
              description:
                "The subject topic/section this draws from (a concept label, never a fabricated page number).",
            },
            improve: { type: "string", description: "One line: what to reinforce if the student fails it." },
          },
          required: ["question", "steps", "why", "topic", "cite", "improve"],
        },
      },
    },
    required: ["items"],
  }
}

const SYSTEM =
  "You are the ordering-exercise agent: you write 'arrange the steps' exercises for a university course. " +
  `${SUBJECT_GROUNDING_POLICY} RULES: (1) Each exercise is a real procedure/sequence of the subject ` +
  "(an algorithm, method, derivation, protocol, lifecycle) with 3–5 steps. (2) The correct order must be " +
  "UNAMBIGUOUS — if two steps could swap without breaking the procedure, rewrite them. (3) Each step is one " +
  "short, self-contained line that does NOT number itself or leak its position ('primero', 'luego', 'paso 2'). " +
  "(4) Ground everything in subject content, never document metadata."

export async function orderingAgent(
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
    schemaName: "ordering",
  })
  if (!out) return []
  return out.items
    .map((it): QuizQuestion | null => {
      const steps = it.steps.map((s) => s.trim()).filter(Boolean)
      if (steps.length < 3) return null // too short to be a meaningful sequence
      const why = it.why?.trim()
      const topic = it.topic?.trim()
      const cite = it.cite?.trim()
      const improve = it.improve?.trim()
      return {
        question: it.question.trim() || "Ordena los pasos",
        options: [],
        answer: 0,
        explanation: why ?? "",
        kind: "order",
        steps,
        ...(why ? { whyYes: [why] } : {}),
        ...(topic ? { topic } : {}),
        ...(cite ? { cite } : {}),
        ...(improve ? { improve } : {}),
      }
    })
    .filter((q): q is QuizQuestion => q !== null)
}
