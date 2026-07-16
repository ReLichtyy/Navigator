/**
 * agents/matching.ts — Conexiones (matching) exercise generator. Produces
 * "match each concept with what it does" items: a set of left↔right pairs the
 * student links. Grounded in the subject like the inquisitor. Emitted into the
 * same quiz bank with `kind: "conex"` (options/answer unused).
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
      topic: z.string().optional(),
      cite: z.string().optional(),
      improve: z.string().optional(),
      pairs: z.array(z.object({ left: z.string(), right: z.string() })),
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
        description: `EXACTLY ${count} matching exercises. Each covers ONE topic of the course.`,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            question: {
              type: "string",
              description:
                "The instruction, e.g. 'Une cada comando con lo que hace' — short, in the output language.",
            },
            topic: { type: "string", description: "The topic this exercise assesses" },
            cite: {
              type: "string",
              description:
                "The subject topic/section this draws from (a concept label, never a fabricated page number).",
            },
            improve: { type: "string", description: "One line: what to reinforce if the student fails it." },
            pairs: {
              type: "array",
              description:
                "3–5 pairs. `left` = a concept/term/command; `right` = its definition/effect. Each left must " +
                "match EXACTLY ONE right, and the rights must be clearly distinguishable (no two interchangeable).",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  left: { type: "string", description: "Concept/term (keep it short)" },
                  right: { type: "string", description: "Its matching definition/effect" },
                },
                required: ["left", "right"],
              },
            },
          },
          required: ["question", "topic", "cite", "improve", "pairs"],
        },
      },
    },
    required: ["items"],
  }
}

const SYSTEM =
  "You are the matching-exercise agent: you write 'connect each concept with what it does' exercises for a " +
  `university course. ${SUBJECT_GROUNDING_POLICY} RULES: (1) Each exercise has 3–5 pairs. (2) Every left term ` +
  "matches EXACTLY ONE right, and no two rights are interchangeable — the mapping must be unambiguous. " +
  "(3) Draw both sides from real subject content (concepts, terms, definitions, effects), never metadata. " +
  "(4) Keep the left side short (a term/command) and the right side a concise definition or effect."

/** Deterministic-free shuffle of [0..n) using the provided rand. */
function shuffledIndexes(n: number, rand: () => number): number[] {
  const order = Array.from({ length: n }, (_, i) => i)
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  return order
}

export async function matchingAgent(
  evidence: string,
  opts: StudyGenOptions = {},
  count = 3,
  rand: () => number = Math.random,
): Promise<QuizQuestion[]> {
  const out = await runAgent({
    role: "inquisitor",
    system: SYSTEM,
    user: `${buildDirectives(opts)}\n\nCourse material:\n\n${evidence}`,
    schema: Schema,
    jsonSchema: jsonSchema(count),
    schemaName: "matching",
  })
  if (!out) return []
  return out.items
    .map((it): QuizQuestion | null => {
      const pairs = it.pairs
        .map((p) => ({ l: p.left.trim(), r: p.right.trim() }))
        .filter((p) => p.l.length > 0 && p.r.length > 0)
      if (pairs.length < 3) return null // too small to be a real matching exercise
      // Present the right column in a shuffled order so it isn't already aligned.
      const rightOrder = shuffledIndexes(pairs.length, rand)
      const topic = it.topic?.trim()
      const cite = it.cite?.trim()
      const improve = it.improve?.trim()
      return {
        question: it.question.trim() || "Une cada concepto con su definición",
        options: [],
        answer: 0,
        explanation: "",
        kind: "conex",
        pairs,
        rightOrder,
        ...(topic ? { topic } : {}),
        ...(cite ? { cite } : {}),
        ...(improve ? { improve } : {}),
      }
    })
    .filter((q): q is QuizQuestion => q !== null)
}
