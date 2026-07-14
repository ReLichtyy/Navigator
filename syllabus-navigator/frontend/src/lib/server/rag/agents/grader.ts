/**
 * agents/grader.ts — exam answer grader for the Examen mode. Scores the
 * student's short-answer and development responses against the item's
 * reference (expected answer + key points, or rubric + model solution) with
 * partial credit. BATCHED like the critic: one call grades the whole exam.
 *
 * Returns null when the model (and its fallback) failed — the caller must
 * FAIL CLOSED (surface an error, let the student retry); a silent zero would
 * be a wrong grade, not a degraded one.
 */
import { z } from "zod"
import { runAgent } from "./_base"

export interface GradeInput {
  kind: "short" | "dev"
  question: string
  /** Grading reference: expectedAnswer + keyPoints (short) or rubric + modelSolution (dev). */
  reference: string
  response: string
}

export interface GradeVerdict {
  /** 0-100 percentage of the item's points earned. */
  pct: number
  feedback: string
}

const Schema = z.object({
  grades: z.array(
    z.object({
      index: z.number(),
      pct: z.number(),
      feedback: z.string(),
    }),
  ),
})

const JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    grades: {
      type: "array",
      description: "One grade per answer, by its index. Include EVERY index given.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          index: { type: "number", description: "The answer's index as given" },
          pct: {
            type: "number",
            description:
              "0-100: percentage of the reference's key points / rubric criteria the response correctly " +
              "covers. 100 = fully correct and complete; partial coverage scores proportionally; empty, " +
              "off-topic or wrong responses score 0.",
          },
          feedback: {
            type: "string",
            description:
              "1-3 sentences in the answer's language: what was right, what was missing or wrong, " +
              "naming the specific missed points/criteria.",
          },
        },
        required: ["index", "pct", "feedback"],
      },
    },
  },
  required: ["grades"],
} as const

function system(language: string): string {
  return (
    "You are a strict but fair university exam grader. For each numbered answer you receive the question, " +
    "the grading REFERENCE (key points a correct answer must cover, or a rubric with a model solution) and " +
    "the student's response. Grade EACH answer: pct = percentage of the reference's points/criteria the " +
    "response correctly covers, judged on substance — wording may differ, correct reasoning in other words " +
    "still counts; factual errors, contradictions and padding do not. Award partial credit point by point. " +
    "An empty, off-topic or fundamentally wrong response scores 0. Never award points for confidence or " +
    `length alone. Write the feedback in ${language} (the student's language), 1-3 sentences, naming what ` +
    "was missing or wrong. One grade per index; include every index."
  )
}

/**
 * Grade every open answer in one call. Returns an array aligned to `items`
 * (index i ↔ items[i]); null when the whole call failed after fallback.
 */
export async function gradeOpenAnswers(
  items: GradeInput[],
  language = "es",
): Promise<GradeVerdict[] | null> {
  if (items.length === 0) return []
  const list = items
    .map(
      (it, i) =>
        `#${i} [${it.kind === "dev" ? "development" : "short answer"}]\n` +
        `Question: ${it.question}\nReference:\n${it.reference}\n` +
        `Student response:\n${it.response || "(no answer)"}`,
    )
    .join("\n\n---\n\n")
  const out = await runAgent({
    role: "grader",
    system: system(language),
    user: `Answers to grade:\n\n${list}`,
    schema: Schema,
    jsonSchema: JSON_SCHEMA as unknown as Record<string, unknown>,
    schemaName: "exam_grades",
    temperature: 0,
  })
  if (!out) return null
  const aligned: GradeVerdict[] = items.map(() => ({ pct: 0, feedback: "" }))
  for (const g of out.grades) {
    if (g.index >= 0 && g.index < aligned.length) {
      aligned[g.index] = { pct: g.pct, feedback: g.feedback.trim() }
    }
  }
  return aligned
}
