/**
 * agents/synth.ts — Synthesizer agent. Produces the holistic artifacts (summary,
 * mind map, weighted study guide) from the evidence. Long-context, faithful.
 */
import { z } from "zod"
import { runAgent } from "./_base"
import {
  buildDirectives,
  SUBJECT_GROUNDING_POLICY,
  type StudyGenOptions,
  type SummaryPoint,
  type MindBranch,
  type StudyGuideSection,
} from "../study-gen"

const Schema = z.object({
  summary: z.object({
    intro: z.string(),
    points: z.array(z.object({ title: z.string(), body: z.string() })),
  }),
  mindmap: z.object({
    center: z.string(),
    branches: z.array(z.object({ label: z.string(), items: z.array(z.string()) })),
  }),
  studyGuide: z
    .array(z.object({ topic: z.string(), weight: z.number(), points: z.array(z.string()) }))
    .optional(),
})

const JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: {
      type: "object",
      additionalProperties: false,
      properties: {
        intro: { type: "string", description: "1–2 sentence overview" },
        points: {
          type: "array",
          description: "3–6 key points",
          items: {
            type: "object",
            additionalProperties: false,
            properties: { title: { type: "string" }, body: { type: "string" } },
            required: ["title", "body"],
          },
        },
      },
      required: ["intro", "points"],
    },
    mindmap: {
      type: "object",
      additionalProperties: false,
      properties: {
        center: { type: "string" },
        branches: {
          type: "array",
          description: "3–5 branches",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              label: { type: "string" },
              items: { type: "array", items: { type: "string" }, description: "2–4 sub-items" },
            },
            required: ["label", "items"],
          },
        },
      },
      required: ["center", "branches"],
    },
    studyGuide: {
      type: "array",
      description:
        "Ordered study guide, ONE section per main topic, heaviest exam weight first. 3–6 sections.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          topic: { type: "string" },
          weight: { type: "number", description: "Exam weight 0–100; 0 when unknown" },
          points: { type: "array", items: { type: "string" }, description: "2–5 things to study" },
        },
        required: ["topic", "weight", "points"],
      },
    },
  },
  required: ["summary", "mindmap", "studyGuide"],
} as const

const SYSTEM =
  "You are the synthesizer agent: produce a summary, a mind map, and a weight-ordered study guide that " +
  "capture the SUBJECT of the course (the actual academic content of its topics, not the document's " +
  "schedule/weights). " +
  SUBJECT_GROUNDING_POLICY

export interface SynthResult {
  summary: { intro: string; points: SummaryPoint[] }
  mindmap: { center: string; branches: MindBranch[] }
  studyGuide?: StudyGuideSection[]
}

export async function synthAgent(
  evidence: string,
  opts: StudyGenOptions = {},
): Promise<SynthResult | null> {
  const out = await runAgent({
    role: "synth",
    system: SYSTEM,
    user: `${buildDirectives(opts)}\n\nCourse material:\n\n${evidence}`,
    schema: Schema,
    jsonSchema: JSON_SCHEMA as unknown as Record<string, unknown>,
    schemaName: "synth",
    temperature: 0.4,
  })
  if (!out) return null

  const points: SummaryPoint[] = out.summary.points
    .map((p) => ({ title: p.title.trim(), body: p.body.trim() }))
    .filter((p) => p.title.length > 0 || p.body.length > 0)
  const branches: MindBranch[] = out.mindmap.branches
    .map((b) => ({ label: b.label.trim(), items: b.items.map((i) => i.trim()).filter(Boolean) }))
    .filter((b) => b.label.length > 0)
  const studyGuide: StudyGuideSection[] = (out.studyGuide ?? [])
    .map((s) => ({
      topic: s.topic.trim(),
      weight: Math.min(Math.max(s.weight, 0), 100),
      points: s.points.map((p) => p.trim()).filter(Boolean),
    }))
    .filter((s) => s.topic.length > 0 && s.points.length > 0)
    .sort((a, b) => b.weight - a.weight)

  return {
    summary: { intro: out.summary.intro.trim(), points },
    mindmap: { center: out.mindmap.center.trim(), branches },
    ...(studyGuide.length > 0 ? { studyGuide } : {}),
  }
}
