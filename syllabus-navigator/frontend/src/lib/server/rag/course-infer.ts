/**
 * server/rag/course-infer.ts — infer which course a freshly-ingested document
 * belongs to. Given the document's filename + extracted text and the user's
 * existing courses, an OpenAI structured-output call returns the best course
 * name + a confidence, optionally matching one of the existing courses.
 *
 * Runs on OpenAI direct (MODEL_RAG, default gpt-5-mini) via gatewayJson — same as graph-gen.
 * Pure inference — it never writes to the DB; the service persists the result.
 */

import { z } from "zod"
import { gatewayJson, extractJson } from "@/lib/llm/gateway-generate"
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

const SYSTEM_PROMPT =
  "You classify an uploaded academic document (syllabus, notes, article) into the course it " +
  "belongs to. You are given the document's filename, a text excerpt, and the user's existing " +
  "courses. If the document clearly belongs to one of the existing courses, return its id as " +
  "matched_course_id and reuse its name. Otherwise set matched_course_id to null and propose a " +
  "concise new course name (in the document's language) plus 2-5 subject tags. Base confidence " +
  "on how clearly the subject is identifiable; be conservative when unsure.\n\n" +
  'JSON shape: {"matched_course_id":string|null,"suggested_name":string,' +
  '"confidence":number,"subject_tags":string[]}'

// Keep the prompt cheap/bounded; the first pages carry the course identity.
const MAX_INFER_CHARS = 6000

export async function inferCourse(
  filename: string,
  text: string,
  existing: ExistingCourse[],
): Promise<CourseInference> {
  const excerpt = text.slice(0, MAX_INFER_CHARS)
  const courseList =
    existing.length > 0
      ? existing
          .map((c) => `- id=${c.id} name="${c.name}" tags=[${(c.subject_tags ?? []).join(", ")}]`)
          .join("\n")
      : "(none yet)"

  try {
    const raw = await gatewayJson(
      SYSTEM_PROMPT,
      `Existing courses:\n${courseList}\n\n` +
        `Document filename: ${filename}\n\n` +
        `Document excerpt:\n${excerpt}`,
    )
    const parsed = InferenceSchema.parse(JSON.parse(extractJson(raw)))

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
