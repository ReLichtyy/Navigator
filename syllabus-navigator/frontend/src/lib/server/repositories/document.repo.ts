import { sql } from "@/lib/db"

export interface DbDocument {
  id: string
  user_id: string
  original_filename: string
  source_hash: string
  status: string
  graph_status: string
  error_message?: string | null
  graph_error?: string | null
  file_url?: string | null
  expires_at?: string | null
}

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

  async listUploads(userId: string): Promise<DbDocument[]> {
    const rows = await sql`
      SELECT id, original_filename, status, graph_status, error_message, graph_error, file_url, created_at
      FROM syllabus_uploads
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
    `
    return rows as DbDocument[]
  },

  async createUpload(
    userId: string,
    filename: string,
    sourceHash: string,
    opts: { fileUrl?: string | null; expiresAt?: string | null } = {},
  ): Promise<{ id: string; original_filename: string }> {
    const { fileUrl = null, expiresAt = null } = opts
    // Idempotent per (user_id, source_hash): re-uploading the same PDF resets it
    // for re-processing instead of erroring on the UNIQUE constraint.
    const rows = await sql`
      INSERT INTO syllabus_uploads
        (user_id, original_filename, source_hash, status, graph_status, file_url, expires_at)
      VALUES (${userId}, ${filename}, ${sourceHash}, 'pending', 'pending', ${fileUrl}, ${expiresAt})
      ON CONFLICT (user_id, source_hash) DO UPDATE
        SET status = 'pending', graph_status = 'pending',
            error_message = NULL, graph_error = NULL,
            original_filename = EXCLUDED.original_filename,
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
