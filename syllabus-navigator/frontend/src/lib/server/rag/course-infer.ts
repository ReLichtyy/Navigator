/**
 * server/rag/course-infer.ts — infer which course a freshly-ingested document
 * belongs to. Given the document's filename + extracted text and the user's
 * existing courses, an OpenAI structured-output call returns the best course
 * name + a confidence, optionally matching one of the existing courses.
 *
 * Mirrors graph-gen.ts (strict json_schema, DEFAULT_MODEL, lazy client).
 * Pure inference — it never writes to the DB; the service persists the result.
 */

import OpenAI from "openai"
import { z } from "zod"
import { DEFAULT_MODEL } from "@/lib/llm/config"
import { logError } from "@/lib/observability/logger"

export interface ExistingCourse {
  id: string
  name: string
  subject_tags: string[] | null
}

export interface CourseInference {
  /** Matched existing course id, or null when a brand-new course is suggested. */
  matchedCourseId: string | null
  /** Course name to show the user (the existing course's name, or a new one). */
  suggestedName: string
  /** 0..1 — how confident the model is in the suggestion. */
  confidence: number
  /** Tags that would describe a newly-created course (empty when matched). */
  subjectTags: string[]
  /** Which signal drove the suggestion. */
  method: "filename" | "content" | "combined"
}

const InferenceSchema = z.object({
  matched_course_id: z.string().nullable(),
  suggested_name: z.string().min(1),
  confidence: z.number().min(0).max(1),
  subject_tags: z.array(z.string()),
})

const INFERENCE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    matched_course_id: {
      type: ["string", "null"],
      description: "id of an existing course this document belongs to, or null if none fits",
    },
    suggested_name: {
      type: "string",
      description: "the course name to assign — the matched course's name, or a concise new one",
    },
    confidence: {
      type: "number",
      description: "0.0-1.0 confidence in the suggestion",
    },
    subject_tags: {
      type: "array",
      items: { type: "string" },
      description:
        "2-5 lowercase topic tags for a NEW course; empty array when matched_course_id is set",
    },
  },
  required: ["matched_course_id", "suggested_name", "confidence", "subject_tags"],
} as const

const SYSTEM_PROMPT =
  "You classify an uploaded academic document (syllabus, notes, article) into the course it " +
  "belongs to. You are given the document's filename, a text excerpt, and the user's existing " +
  "courses. If the document clearly belongs to one of the existing courses, return its id as " +
  "matched_course_id and reuse its name. Otherwise set matched_course_id to null and propose a " +
  "concise new course name (in the document's language) plus 2-5 subject tags. Base confidence " +
  "on how clearly the subject is identifiable; be conservative when unsure."

// Keep the prompt cheap/bounded; the first pages carry the course identity.
const MAX_INFER_CHARS = 6000

let _client: OpenAI | null = null
function getClient(): OpenAI {
  if (!_client) {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) throw new Error("OPENAI_API_KEY is not configured")
    _client = new OpenAI({ apiKey })
  }
  return _client
}

export async function inferCourse(
  filename: string,
  text: string,
  existing: ExistingCourse[],
): Promise<CourseInference> {
  const client = getClient()
  const excerpt = text.slice(0, MAX_INFER_CHARS)
  const courseList =
    existing.length > 0
      ? existing
          .map((c) => `- id=${c.id} name="${c.name}" tags=[${(c.subject_tags ?? []).join(", ")}]`)
          .join("\n")
      : "(none yet)"

  try {
    const completion = await client.chat.completions.create({
      model: DEFAULT_MODEL,
      temperature: 0,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content:
            `Existing courses:\n${courseList}\n\n` +
            `Document filename: ${filename}\n\n` +
            `Document excerpt:\n${excerpt}`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "course_inference",
          strict: true,
          schema: INFERENCE_JSON_SCHEMA as unknown as Record<string, unknown>,
        },
      },
    })

    const raw = completion.choices[0]?.message?.content ?? "{}"
    const parsed = InferenceSchema.parse(JSON.parse(raw))

    // Only trust a matched id if it's actually one we offered.
    const matchedCourseId =
      parsed.matched_course_id && existing.some((c) => c.id === parsed.matched_course_id)
        ? parsed.matched_course_id
        : null

    return {
      matchedCourseId,
      suggestedName: parsed.suggested_name.trim(),
      confidence: parsed.confidence,
      subjectTags: matchedCourseId ? [] : parsed.subject_tags.map((t) => t.trim()).filter(Boolean),
      method: matchedCourseId ? "combined" : "content",
    }
  } catch (err) {
    logError("rag.course_infer.error", { error: err instanceof Error ? err.message : String(err) })
    throw err
  }
}
