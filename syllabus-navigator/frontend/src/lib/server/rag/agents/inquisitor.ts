/**
 * agents/inquisitor.ts — Inquisitor agent. Exam-style multiple-choice questions
 * with plausible distractors, grounded in the evidence. Accuracy matters → uses
 * a stronger model preset (see agent-models). `count` lets the staged quiz
 * request a small batch at a target difficulty instead of one big set.
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
  quiz: z.array(
    z.object({
      question: z.string(),
      options: z.array(z.string()),
      answer: z.number(),
      explanation: z.string(),
      topic: z.string().optional(),
    }),
  ),
})

function jsonSchema(count: number): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      quiz: {
        type: "array",
        description:
          `EXACTLY ${count} multiple-choice questions (generate ${count}; never fewer). Spread them ` +
          "across the topics in the material — do not cluster on one section. Favor application/analysis over pure recall.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            question: {
              type: "string",
              description:
                "A question that tests understanding or application of a SPECIFIC concept, definition, " +
                "relationship, formula or example from one of the course's topics — NOT a question about the " +
                "document's schedule, dates, weights or other administrative metadata.",
            },
            options: { type: "array", items: { type: "string" }, description: "4 options (one correct, three distractors)" },
            answer: { type: "number", description: "0-based index of the single correct option" },
            explanation: {
              type: "string",
              description:
                "Explain the subject concept that makes the answer correct, and say briefly why each distractor is wrong.",
            },
            topic: { type: "string", description: "The topic this question assesses (a weighted topic label when provided)" },
          },
          required: ["question", "options", "answer", "explanation", "topic"],
        },
      },
    },
    required: ["quiz"],
  }
}

function system(count: number): string {
  return (
    "You are the inquisitor agent: you write exam-style multiple-choice questions for a university " +
    `course. ${SUBJECT_GROUNDING_POLICY} RULES: (1) Produce EXACTLY ${count} questions. (2) Each question ` +
    "must test genuine understanding or application of the subject — a concept, definition, mechanism, " +
    "formula, relationship or worked example from one of the course's topics; reject trivia and anything " +
    "about the document's metadata (schedule, dates, weights). (3) Draw the distractors from real, related " +
    "concepts of the subject so they are tempting but wrong — never filler like 'none of the above'. " +
    "(4) Exactly ONE option is correct and unambiguous. (5) Cover the breadth of the course's topics, " +
    "weighting heavier exam topics more."
  )
}

export async function inquisitorAgent(
  evidence: string,
  opts: StudyGenOptions = {},
  count = 20,
): Promise<QuizQuestion[]> {
  const out = await runAgent({
    role: "inquisitor",
    system: system(count),
    user: `${buildDirectives(opts)}\n\nCourse material:\n\n${evidence}`,
    schema: Schema,
    jsonSchema: jsonSchema(count),
    schemaName: "quiz",
  })
  if (!out) return []
  return out.quiz
    .map((q) => {
      const options = q.options.map((o) => o.trim()).filter((o) => o.length > 0)
      const answer = Math.min(Math.max(Math.trunc(q.answer), 0), Math.max(options.length - 1, 0))
      const topic = q.topic?.trim()
      return {
        question: q.question.trim(),
        options,
        answer,
        explanation: q.explanation.trim(),
        ...(topic ? { topic } : {}),
      }
    })
    .filter((q) => q.question.length > 0 && q.options.length >= 2)
}
