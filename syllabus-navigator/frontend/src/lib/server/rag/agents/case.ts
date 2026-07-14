/**
 * agents/case.ts — development/application exercise generator for the Examen
 * mode (finally puts the long-reserved "case" role to work). Each item carries
 * a grading rubric + model solution so the grader agent can award partial
 * credit criterion by criterion.
 */
import { z } from "zod"
import { runAgent } from "./_base"
import { buildDirectives, SUBJECT_GROUNDING_POLICY, type StudyGenOptions } from "../study-gen"
import { normalizeCaseItems, type CaseItem } from "../exam-gen"

const Schema = z.object({
  items: z.array(
    z.object({
      prompt: z.string(),
      rubric: z.array(z.string()),
      modelSolution: z.string(),
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
          `EXACTLY ${count} development exercises (generate ${count}; never fewer). ` +
          "Each on a different heavy topic when possible.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            prompt: {
              type: "string",
              description:
                "A development exercise: a problem to solve, a case to analyze, a derivation, a design or an " +
                "argued essay prompt — something requiring several steps of reasoning about the SUBJECT, with " +
                "all data needed to solve it. NOT about the document's schedule/weights/metadata.",
            },
            rubric: {
              type: "array",
              items: { type: "string" },
              description:
                "3-5 concrete, independently checkable grading criteria of similar weight (what a full answer " +
                "must demonstrate), each one short sentence.",
            },
            modelSolution: {
              type: "string",
              description:
                "A worked model solution or reference answer covering every rubric criterion, step by step.",
            },
            topic: {
              type: "string",
              description: "The topic this exercise assesses (a weighted topic label when provided)",
            },
          },
          required: ["prompt", "rubric", "modelSolution", "topic"],
        },
      },
    },
    required: ["items"],
  }
}

function system(count: number): string {
  return (
    "You are the case agent: you write development/application exam exercises for a university course. " +
    `${SUBJECT_GROUNDING_POLICY} RULES: (1) Produce EXACTLY ${count} exercises. (2) Each demands ` +
    "multi-step reasoning — solving, analyzing, deriving, designing or arguing about the subject — and is " +
    "self-contained (include any data needed). (3) Match the exercise style to the subject: numeric problem " +
    "for calculation-heavy subjects, case analysis or argued development for theory-heavy ones. " +
    "(4) The rubric has 3-5 concrete criteria of similar weight a grader can check independently. " +
    "(5) modelSolution works through the answer step by step and covers every criterion."
  )
}

export async function caseAgent(
  evidence: string,
  opts: StudyGenOptions = {},
  count = 1,
): Promise<CaseItem[]> {
  const out = await runAgent({
    role: "case",
    system: system(count),
    user: `${buildDirectives(opts)}\n\nCourse material:\n\n${evidence}`,
    schema: Schema,
    jsonSchema: jsonSchema(count),
    schemaName: "development_items",
  })
  if (!out) return []
  return normalizeCaseItems(out.items)
}
