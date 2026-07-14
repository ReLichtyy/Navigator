/**
 * agents/recall.ts — short-answer question generator for the Examen mode.
 * Each item carries the expected answer + the key points a correct response
 * must cover, so the grader agent can award partial credit against them.
 * Modeled on the inquisitor (strict json_schema, EXACT count, subject-grounded).
 */
import { z } from "zod"
import { runAgent } from "./_base"
import { buildDirectives, SUBJECT_GROUNDING_POLICY, type StudyGenOptions } from "../study-gen"
import { normalizeRecallItems, type RecallItem } from "../exam-gen"

const Schema = z.object({
  items: z.array(
    z.object({
      question: z.string(),
      expectedAnswer: z.string(),
      keyPoints: z.array(z.string()),
      topic: z.string().optional(),
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
        description:
          `EXACTLY ${count} short-answer questions (generate ${count}; never fewer). Spread them across ` +
          "the topics in the material — do not cluster on one section.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            question: {
              type: "string",
              description:
                "A question answerable in 1-3 sentences that tests understanding of a SPECIFIC concept, " +
                "definition, mechanism or relationship from one of the course's topics — NOT the document's " +
                "schedule, dates, weights or other administrative metadata.",
            },
            expectedAnswer: {
              type: "string",
              description: "The model answer, 1-3 sentences, precise and complete.",
            },
            keyPoints: {
              type: "array",
              items: { type: "string" },
              description:
                "2-4 short key points a correct answer must cover — the grading checklist for partial credit.",
            },
            topic: {
              type: "string",
              description: "The topic this question assesses (a weighted topic label when provided)",
            },
          },
          required: ["question", "expectedAnswer", "keyPoints", "topic"],
        },
      },
    },
    required: ["items"],
  }
}

function system(count: number): string {
  return (
    "You are the recall agent: you write short-answer exam questions for a university course. " +
    `${SUBJECT_GROUNDING_POLICY} RULES: (1) Produce EXACTLY ${count} questions. (2) Each must be ` +
    "answerable in 1-3 sentences and test genuine understanding of the subject — definitions, mechanisms, " +
    "relationships, brief explanations; never metadata about the document (schedule, dates, weights). " +
    "(3) expectedAnswer is the precise model answer. (4) keyPoints are the 2-4 checkable facts a correct " +
    "answer must contain — write them so a grader can award partial credit point by point. " +
    "(5) Cover the breadth of the course's topics, weighting heavier exam topics more."
  )
}

export async function recallAgent(
  evidence: string,
  opts: StudyGenOptions = {},
  count = 4,
): Promise<RecallItem[]> {
  const out = await runAgent({
    role: "recall",
    system: system(count),
    user: `${buildDirectives(opts)}\n\nCourse material:\n\n${evidence}`,
    schema: Schema,
    jsonSchema: jsonSchema(count),
    schemaName: "short_answer_items",
  })
  if (!out) return []
  return normalizeRecallItems(out.items)
}
