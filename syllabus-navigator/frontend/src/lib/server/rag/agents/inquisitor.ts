/**
 * agents/inquisitor.ts — Inquisitor agent. Exam-style multiple-choice questions
 * with plausible distractors, grounded in the evidence. Accuracy matters → uses
 * a stronger model preset (see agent-models).
 */
import { z } from "zod"
import { runAgent } from "./_base"
import { buildDirectives, type QuizQuestion, type StudyGenOptions } from "../study-gen"

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

const JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    quiz: {
      type: "array",
      description: "6–10 multiple-choice questions. Favor application/analysis over pure recall.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          question: { type: "string" },
          options: { type: "array", items: { type: "string" }, description: "3–4 options" },
          answer: { type: "number", description: "0-based index of the single correct option" },
          explanation: { type: "string", description: "Why the answer is correct (and others wrong)" },
          topic: { type: "string", description: "The topic this question assesses (a weighted topic label when provided)" },
        },
        required: ["question", "options", "answer", "explanation", "topic"],
      },
    },
  },
  required: ["quiz"],
} as const

const SYSTEM =
  "You are the inquisitor agent: you write exam-style multiple-choice questions for a university " +
  "course. Each question has exactly ONE correct option and plausible, non-ambiguous distractors. " +
  "Prefer questions that test application and reasoning over rote recall. Ground every question in " +
  "the supplied material — never invent facts. Preserve the language of the material."

export async function inquisitorAgent(
  evidence: string,
  opts: StudyGenOptions = {},
): Promise<QuizQuestion[]> {
  const out = await runAgent({
    role: "inquisitor",
    system: SYSTEM,
    user: `${buildDirectives(opts)}\n\nCourse material:\n\n${evidence}`,
    schema: Schema,
    jsonSchema: JSON_SCHEMA as unknown as Record<string, unknown>,
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
