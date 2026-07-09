import { sql } from "@/lib/db"

export interface DbDocument {
  id: string
  user_id: string
  original_filename: string
  source_hash: string
  source_type?: string
  source_url?: string | null
  status: string
  graph_status: string
  error_message?: string | null
  graph_error?: string | null
  layout?: string | null
  file_url?: string | null
  expires_at?: string | null
  // Course Intelligence Layer
  course_id?: string | null
  inferred_course?: string | null
  infer_confidence?: number | null
  infer_status?: string
}

export type InferStatus = "pending" | "suggested" | "confirmed" | "rejected" | "skipped"

export const DocumentRepository = {
  async findByIdAndUser(docId: string, userId: string): Promise<DbDocument | undefined> {
    const rows = await sql`
      SELECT * 
      FROM syllabus_uploads
      WHERE id = ${docId}::uuid AND user_id = ${userId}
    `
    return rows[0] as DbDocument | undefined
  },

  async deleteDocument(docId: string, userId: string): Promise<void> {
    await sql`
      DELETE FROM syllabus_uploads
      WHERE id = ${docId}::uuid AND user_id = ${userId}
    `
  },

  /**
   * Delete every document assigned to a course (used by course deletion, which
   * cascades to its contents). Chunks/graphs/etc. follow via their own FKs.
   * Returns the stored-file URLs of the removed documents so the caller can
   * clean up their blobs.
   */
  async deleteByCourse(
    courseId: string,
    userId: string,
  ): Promise<{ count: number; fileUrls: string[] }> {
    const rows = await sql`
      DELETE FROM syllabus_uploads
      WHERE course_id = ${courseId}::uuid AND user_id = ${userId}
      RETURNING file_url
    `
    return {
      count: rows.length,
      fileUrls: (rows as { file_url: string | null }[])
        .map((r) => r.file_url)
        .filter((u): u is string => Boolean(u)),
    }
  },

  async listUploads(userId: string): Promise<DbDocument[]> {
    const rows = await sql`
      SELECT id, original_filename, source_type, source_url, status, graph_status,
             error_message, graph_error, file_url, created_at,
             course_id, inferred_course, infer_confidence, infer_status
      FROM syllabus_uploads
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
    `
    return rows as DbDocument[]
  },

  /** Full row by id (no ownership filter) — for the worker, which has no userId. */
  async findById(syllabusId: string): Promise<DbDocument | undefined> {
    const rows = await sql`
      SELECT * FROM syllabus_uploads WHERE id = ${syllabusId}::uuid
    `
    return rows[0] as DbDocument | undefined
  },

  /** Store the latest inference result (called by the worker). Never sets course_id. */
  async setInference(
    syllabusId: string,
    inferredCourse: string,
    confidence: number,
    status: InferStatus = "suggested",
  ): Promise<void> {
    await sql`
      UPDATE syllabus_uploads
      SET inferred_course = ${inferredCourse}, infer_confidence = ${confidence},
          infer_status = ${status}, updated_at = now()
      WHERE id = ${syllabusId}::uuid
    `
  },

  /**
   * Assign (or clear) a document's course after the user confirms, and move the
   * inference state machine to its terminal value. Ownership-scoped.
   */
  async assignCourse(
    docId: string,
    userId: string,
    courseId: string | null,
    status: InferStatus,
  ): Promise<DbDocument | undefined> {
    const rows = await sql`
      UPDATE syllabus_uploads
      SET course_id = ${courseId}, infer_status = ${status}, updated_at = now()
      WHERE id = ${docId}::uuid AND user_id = ${userId}
      RETURNING id, original_filename, course_id, infer_status, inferred_course, infer_confidence
    `
    return rows[0] as DbDocument | undefined
  },

  async createUpload(
    userId: string,
    filename: string,
    sourceHash: string,
    opts: {
      fileUrl?: string | null
      expiresAt?: string | null
      sourceType?: string
      sourceUrl?: string | null
    } = {},
  ): Promise<{ id: string; original_filename: string }> {
    const { fileUrl = null, expiresAt = null, sourceType = "pdf", sourceUrl = null } = opts
    // Idempotent per (user_id, source_hash): re-uploading the same source resets
    // it for re-processing instead of erroring on the UNIQUE constraint.
    const rows = await sql`
      INSERT INTO syllabus_uploads
        (user_id, original_filename, source_hash, source_type, source_url,
         status, graph_status, file_url, expires_at)
      VALUES (${userId}, ${filename}, ${sourceHash}, ${sourceType}, ${sourceUrl},
              'pending', 'pending', ${fileUrl}, ${expiresAt})
      ON CONFLICT (user_id, source_hash) DO UPDATE
        SET status = 'pending', graph_status = 'pending',
            error_message = NULL, graph_error = NULL,
            original_filename = EXCLUDED.original_filename,
            source_type = EXCLUDED.source_type, source_url = EXCLUDED.source_url,
            file_url = EXCLUDED.file_url, expires_at = EXCLUDED.expires_at,
            updated_at = now()
      RETURNING id, original_filename
    `
    return rows[0] as { id: string; original_filename: string }
  },

  /** Update ingestion status (called by the worker). */
  async setStatus(
    syllabusId: string,
    status: string,
    errorMessage: string | null = null,
  ): Promise<void> {
    await sql`
      UPDATE syllabus_uploads
      SET status = ${status}, error_message = ${errorMessage}, updated_at = now()
      WHERE id = ${syllabusId}::uuid
    `
  },

  /** Update graph generation status (called by the worker). */
  async setGraphStatus(
    syllabusId: string,
    graphStatus: string,
    graphError: string | null = null,
  ): Promise<void> {
    const isReady = graphStatus === "ready"
    await sql`
      UPDATE syllabus_uploads
      SET graph_status = ${graphStatus}, graph_error = ${graphError},
          graph_generated_at = CASE WHEN ${isReady} THEN now() ELSE graph_generated_at END,
          updated_at = now()
      WHERE id = ${syllabusId}::uuid
    `
  },

  async renameDocument(
    docId: string,
    userId: string,
    newName: string,
  ): Promise<DbDocument | undefined> {
    const rows = await sql`
      UPDATE syllabus_uploads
      SET original_filename = ${newName}
      WHERE id = ${docId}::uuid AND user_id = ${userId}
      RETURNING id, original_filename, status, graph_status
    `
    return rows[0] as DbDocument | undefined
  },
}
