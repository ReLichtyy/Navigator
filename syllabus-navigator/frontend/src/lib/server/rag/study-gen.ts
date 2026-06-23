/**
 * server/rag/study-gen.ts — generate a per-course "study set" from the syllabus
 * material: flashcards, a multiple-choice quiz, an auto-summary and a mind map.
 *
 * Same shape as graph-gen.ts / schedule-gen.ts: one OpenAI strict structured-output
 * call → validated + normalized rows. Powers the "Área de Estudio" window.
 */

import OpenAI from "openai"
import { z } from "zod"
import { DEFAULT_MODEL } from "@/lib/llm/config"
import { logError } from "@/lib/observability/logger"

// ---------- public shape (what the UI consumes) ----------

export interface Flashcard {
  front: string
  back: string
}

export interface QuizQuestion {
  question: string
  options: string[] // 2–5 options
  answer: number // index into options
  explanation: string
}

export interface SummaryPoint {
  title: string
  body: string
}

export interface MindBranch {
  label: string
  items: string[]
}

export interface StudySet {
  flashcards: Flashcard[]
  quiz: QuizQuestion[]
  summary: { intro: string; points: SummaryPoint[] }
  mindmap: { center: string; branches: MindBranch[] }
}

// ---------- LLM contract ----------

const StudySchema = z.object({
  flashcards: z.array(z.object({ front: z.string(), back: z.string() })),
  quiz: z.array(
    z.object({
      question: z.string(),
      options: z.array(z.string()),
      answer: z.number(),
      explanation: z.string(),
    }),
  ),
  summary: z.object({
    intro: z.string(),
    points: z.array(z.object({ title: z.string(), body: z.string() })),
  }),
  mindmap: z.object({
    center: z.string(),
    branches: z.array(z.object({ label: z.string(), items: z.array(z.string()) })),
  }),
})

type RawStudy = z.infer<typeof StudySchema>

const STUDY_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    flashcards: {
      type: "array",
      description: "8–14 concept→definition flashcards",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          front: { type: "string", description: "Concept or question" },
          back: { type: "string", description: "Definition or answer" },
        },
        required: ["front", "back"],
      },
    },
    quiz: {
      type: "array",
      description: "5–10 multiple-choice questions",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          question: { type: "string" },
          options: { type: "array", items: { type: "string" }, description: "3–4 options" },
          answer: { type: "number", description: "0-based index of the correct option" },
          explanation: { type: "string", description: "Why the answer is correct" },
        },
        required: ["question", "options", "answer", "explanation"],
      },
    },
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
            properties: {
              title: { type: "string" },
              body: { type: "string" },
            },
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
        center: { type: "string", description: "Central topic of the course/unit" },
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
  },
  required: ["flashcards", "quiz", "summary", "mindmap"],
} as const

const SYSTEM_PROMPT =
  "You are a study-material generator for a university course. From the provided course material " +
  "(syllabus + notes) produce study aids: flashcards, a multiple-choice quiz, a short summary, and " +
  "a mind map. Ground every item ONLY in the supplied material — never invent facts, dates or topics " +
  "that are not present. Preserve the original language of the material. Each quiz question must have " +
  "exactly one correct option and a brief explanation."

/**
 * Validate + normalize a raw model object into a safe StudySet.
 * Pure (no network) so it can be unit-tested:
 *  - drops empty flashcards / quiz questions,
 *  - keeps quiz items with ≥2 options and clamps `answer` into range,
 *  - trims strings.
 * Returns null when the material yielded nothing usable.
 */
export function normalizeStudySet(raw: unknown): StudySet | null {
  const parsed = StudySchema.safeParse(raw)
  if (!parsed.success) return null
  const r: RawStudy = parsed.data

  const flashcards: Flashcard[] = r.flashcards
    .map((f) => ({ front: f.front.trim(), back: f.back.trim() }))
    .filter((f) => f.front.length > 0 && f.back.length > 0)

  const quiz: QuizQuestion[] = r.quiz
    .map((q) => {
      const options = q.options.map((o) => o.trim()).filter((o) => o.length > 0)
      const answer = Math.min(Math.max(Math.trunc(q.answer), 0), Math.max(options.length - 1, 0))
      return { question: q.question.trim(), options, answer, explanation: q.explanation.trim() }
    })
    .filter((q) => q.question.length > 0 && q.options.length >= 2)

  const points: SummaryPoint[] = r.summary.points
    .map((p) => ({ title: p.title.trim(), body: p.body.trim() }))
    .filter((p) => p.title.length > 0 || p.body.length > 0)

  const branches: MindBranch[] = r.mindmap.branches
    .map((b) => ({ label: b.label.trim(), items: b.items.map((i) => i.trim()).filter(Boolean) }))
    .filter((b) => b.label.length > 0)

  const set: StudySet = {
    flashcards,
    quiz,
    summary: { intro: r.summary.intro.trim(), points },
    mindmap: { center: r.mindmap.center.trim(), branches },
  }

  // Nothing usable at all → signal "not enough material".
  if (set.flashcards.length === 0 && set.quiz.length === 0 && set.summary.points.length === 0) {
    return null
  }
  return set
}

let _client: OpenAI | null = null
function getClient(): OpenAI {
  if (!_client) {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) throw new Error("OPENAI_API_KEY is not configured")
    _client = new OpenAI({ apiKey })
  }
  return _client
}

// Keep token cost bounded — the head of the material is the most relevant for study aids.
const MAX_CHARS = 24_000

/**
 * Generate a study set from course text. Returns null when the model could not
 * derive usable material (e.g. empty/garbled text).
 */
export async function generateStudySet(courseText: string): Promise<StudySet | null> {
  const text = courseText.trim()
  if (text.length < 80) return null // not enough to study from

  const client = getClient()
  try {
    const completion = await client.chat.completions.create({
      model: DEFAULT_MODEL,
      temperature: 0.2,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Generate study material from this course content:\n\n${text.slice(0, MAX_CHARS)}`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "study_set",
          strict: true,
          schema: STUDY_JSON_SCHEMA as unknown as Record<string, unknown>,
        },
      },
    })

    const rawText = completion.choices[0]?.message?.content ?? "{}"
    return normalizeStudySet(JSON.parse(rawText))
  } catch (err) {
    logError("rag.study_gen.error", { error: err instanceof Error ? err.message : String(err) })
    throw err
  }
}
