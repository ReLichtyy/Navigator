/**
 * agents/inquisitor.ts — Inquisitor agent. Exam-style multiple-choice questions
 * with plausible distractors, grounded in the evidence. Accuracy matters → uses
 * a stronger model preset (see agent-models). `count` lets the staged quiz
 * request a small batch at a target difficulty instead of one big set.
 *
 * Each question also carries the redesigned "rich reveal" (AreaEstudio.dc):
 *  · whyYes    — grounded bullets for POR QUÉ SÍ,
 *  · wrongReasons — per-distractor POR QUÉ NO LA TUYA (→ mapped to `whyNo`),
 *  · cite      — the subject topic/section the item draws from (never a fake page),
 *  · improve   — one line naming the skill to reinforce if the student fails it.
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
      whyYes: z.array(z.string()).optional(),
      wrongReasons: z
        .array(z.object({ option: z.number(), reasons: z.array(z.string()) }))
        .optional(),
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
            options: {
              type: "array",
              items: { type: "string" },
              description: "4 options (one correct, three distractors)",
            },
            answer: { type: "number", description: "0-based index of the single correct option" },
            explanation: {
              type: "string",
              description:
                "Explain the subject concept that makes the answer correct, and say briefly why each distractor is wrong.",
            },
            topic: {
              type: "string",
              description:
                "The topic this question assesses (a weighted topic label when provided)",
            },
            whyYes: {
              type: "array",
              items: { type: "string" },
              description:
                "1–2 SHORT bullet phrases (max ~12 words each) explaining why the correct option is right. " +
                "Grounded in the subject; no meta-commentary.",
            },
            wrongReasons: {
              type: "array",
              description:
                "One entry per DISTRACTOR (every option index except the correct one), each with 1–2 short " +
                "bullet phrases saying why THAT specific option is wrong.",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  option: { type: "number", description: "0-based index of the wrong option" },
                  reasons: {
                    type: "array",
                    items: { type: "string" },
                    description: "1–2 short phrases (max ~12 words) on why this option is incorrect",
                  },
                },
                required: ["option", "reasons"],
              },
            },
            cite: {
              type: "string",
              description:
                "The subject topic/section this item draws from, e.g. 'Derivadas · regla de la cadena'. " +
                "NEVER a page/figure number or anything fabricated — a concept label only.",
            },
            improve: {
              type: "string",
              description:
                "One short line naming the skill/concept the student should reinforce if they miss this " +
                "(used in the results 'puntos que mejorar' list).",
            },
          },
          required: [
            "question",
            "options",
            "answer",
            "explanation",
            "topic",
            "whyYes",
            "wrongReasons",
            "cite",
            "improve",
          ],
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
    "weighting heavier exam topics more. (6) Vary the position of the correct option across questions — " +
    "it must NOT default to the first option. (7) For EVERY question also give: `whyYes` (1–2 short " +
    "grounded bullets on why the correct option is right), `wrongReasons` (one entry per distractor with " +
    "1–2 short bullets on why that specific option is wrong), `cite` (the subject topic/section label the " +
    "item comes from — never a fabricated page/figure number), and `improve` (one line naming what to " +
    "reinforce if missed). Keep all bullets short and concrete."
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
      // Clean reveal fields; drop empties so the payload stays lean.
      const whyYes = (q.whyYes ?? []).map((s) => s.trim()).filter(Boolean)
      const whyNo: Record<string, string[]> = {}
      for (const w of q.wrongReasons ?? []) {
        const i = Math.trunc(w.option)
        if (i === answer || i < 0 || i >= options.length) continue // only distractors
        const reasons = (w.reasons ?? []).map((s) => s.trim()).filter(Boolean)
        if (reasons.length > 0) whyNo[String(i)] = reasons
      }
      const cite = q.cite?.trim()
      const improve = q.improve?.trim()
      return {
        question: q.question.trim(),
        options,
        answer,
        explanation: q.explanation.trim(),
        kind: "mc" as const,
        ...(topic ? { topic } : {}),
        ...(whyYes.length > 0 ? { whyYes } : {}),
        ...(Object.keys(whyNo).length > 0 ? { whyNo } : {}),
        ...(cite ? { cite } : {}),
        ...(improve ? { improve } : {}),
      }
    })
    .filter((q) => q.question.length > 0 && q.options.length >= 2)
}
