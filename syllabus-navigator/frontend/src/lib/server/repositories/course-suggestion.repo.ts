import { sql } from "@/lib/db"

export interface DbCourseSuggestion {
  id: string
  document_id: string
  suggested_course_id: string | null
  suggested_name: string
  confidence: number
  method: string
  accepted: boolean | null
  /** Inferred term start (Monday of week 1), yyyy-mm-dd. */
  term_start: string | null
  created_at: string
}

export type SuggestionMethod = "filename" | "content" | "embedding" | "combined"

export const CourseSuggestionRepository = {
  async create(input: {
    documentId: string
    suggestedCourseId: string | null
    suggestedName: string
    confidence: number
    method: SuggestionMethod
    termStart?: string | null
  }): Promise<DbCourseSuggestion> {
    const rows = await sql`
      INSERT INTO course_suggestions
        (document_id, suggested_course_id, suggested_name, confidence, method, term_start)
      VALUES (${input.documentId}::uuid, ${input.suggestedCourseId}, ${input.suggestedName},
              ${input.confidence}, ${input.method}, ${input.termStart ?? null}::date)
      RETURNING *, to_char(term_start, 'YYYY-MM-DD') AS term_start
    `
    return rows[0] as DbCourseSuggestion
  },

  /** Latest suggestion for a document (the one currently shown to the user). */
  async latestForDocument(documentId: string): Promise<DbCourseSuggestion | undefined> {
    const rows = await sql`
      SELECT *, to_char(term_start, 'YYYY-MM-DD') AS term_start FROM course_suggestions
      WHERE document_id = ${documentId}::uuid
      ORDER BY created_at DESC
      LIMIT 1
    `
    return rows[0] as DbCourseSuggestion | undefined
  },

  /** Mark every pending suggestion for a document accepted/rejected. */
  async resolve(documentId: string, accepted: boolean): Promise<void> {
    await sql`
      UPDATE course_suggestions
      SET accepted = ${accepted}
      WHERE document_id = ${documentId}::uuid AND accepted IS NULL
    `
  },
}
