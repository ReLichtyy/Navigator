/**
 * agents/synth.ts — Synthesizer agent. Produces the holistic artifacts (summary,
 * weighted study guide) from the evidence. Long-context, faithful. The mind map
 * is generated separately (agents/mindmap.ts) since its shape varies by mode.
 */
import { z } from "zod"
import { runAgent } from "./_base"
import {
  buildDirectives,
  SUBJECT_GROUNDING_POLICY,
  type StudyGenOptions,
  type Summary,
  type StudyGuideSection,
} from "../study-gen"

const Schema = z.object({
  summary: z.object({
    titulo: z.string(),
    temaPrincipal: z.string(),
    introduccion: z.string(),
    ideasPrincipales: z.array(z.string()),
    conceptos: z.array(z.object({ termino: z.string(), definicion: z.string() })),
    conclusion: z.string(),
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
        titulo: { type: "string", description: "Short title of the topic/course being summarized" },
        temaPrincipal: { type: "string", description: "1 sentence: what this is really about" },
        introduccion: {
          type: "string",
          description:
            "2–4 sentences that situate the student: why this matters, what problem it solves or where it's used — like opening the first class on it",
        },
        ideasPrincipales: {
          type: "array",
          description: "3–5 key ideas, each a complete, self-contained sentence (not a fragment)",
          items: { type: "string" },
        },
        conceptos: {
          type: "array",
          description:
            "3–6 terms the student must be able to recognize, each with a short precise definition",
          items: {
            type: "object",
            additionalProperties: false,
            properties: { termino: { type: "string" }, definicion: { type: "string" } },
            required: ["termino", "definicion"],
          },
        },
        conclusion: {
          type: "string",
          description:
            "1–3 sentences closing the idea: what the student takes away, or how it connects to the rest of the course",
        },
      },
      required: ["titulo", "temaPrincipal", "introduccion", "ideasPrincipales", "conceptos", "conclusion"],
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
  required: ["summary", "studyGuide"],
} as const

const SYSTEM =
  "You are a mentor teaching this course to a student who's counting on you to help them really " +
  "understand it, fast and well. You are not summarizing a document — you are teaching the subject.\n\n" +
  "Produce two things: a SUMMARY and a weight-ordered study guide, both capturing the SUBJECT of the " +
  "course (the actual academic content of its topics, not the document's schedule/weights).\n\n" +
  "Structure the SUMMARY like this:\n" +
  '- "titulo": a clear name for the topic/course.\n' +
  '- "temaPrincipal": one sentence — what this is really about.\n' +
  '- "introduccion": 2–4 sentences that situate the student — why this topic matters, what problem it ' +
  "solves, or where it's used. Like opening the first class on it.\n" +
  '- "ideasPrincipales": 3–5 ideas, each a complete, self-contained sentence (never a fragment). ' +
  "Prioritize the ones that carry the most weight in an exam or that everything else builds on.\n" +
  '- "conceptos": 3–6 terms the student must recognize, each with the short, precise definition you\'d ' +
  "give if they asked \"what's that?\"\n" +
  '- "conclusion": 1–3 sentences closing the idea — what the student takes away, or how it connects to ' +
  "the rest of the course.\n\n" +
  "Tone: close and encouraging, like someone who genuinely wants the student to understand, not just " +
  "memorize. Use analogies or examples when they help fix a hard idea. Anticipate common confusions when " +
  'it feels natural ("this is often confused with X because…"). Be concise — every sentence must earn ' +
  "its place, no filler.\n\n" +
  SUBJECT_GROUNDING_POLICY

export interface SynthResult {
  summary: Summary
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

  const summary: Summary = {
    titulo: out.summary.titulo.trim(),
    temaPrincipal: out.summary.temaPrincipal.trim(),
    introduccion: out.summary.introduccion.trim(),
    ideasPrincipales: out.summary.ideasPrincipales.map((i) => i.trim()).filter(Boolean),
    conceptos: out.summary.conceptos
      .map((c) => ({ termino: c.termino.trim(), definicion: c.definicion.trim() }))
      .filter((c) => c.termino.length > 0 && c.definicion.length > 0),
    conclusion: out.summary.conclusion.trim(),
  }
  const studyGuide: StudyGuideSection[] = (out.studyGuide ?? [])
    .map((s) => ({
      topic: s.topic.trim(),
      weight: Math.min(Math.max(s.weight, 0), 100),
      points: s.points.map((p) => p.trim()).filter(Boolean),
    }))
    .filter((s) => s.topic.length > 0 && s.points.length > 0)
    .sort((a, b) => b.weight - a.weight)

  return {
    summary,
    ...(studyGuide.length > 0 ? { studyGuide } : {}),
  }
}
