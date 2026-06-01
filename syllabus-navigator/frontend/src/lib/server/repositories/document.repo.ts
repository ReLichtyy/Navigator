import { sql } from "@/lib/db"

export interface DbDocument {
  id: string
  user_id: string
  original_filename: string
  source_hash: string
  status: string
  graph_status: string
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

  async deleteDocument(docId: string): Promise<void> {
    await sql`
      DELETE FROM syllabus_uploads
      WHERE id = ${docId}::uuid
    `
  },

  async listUploads(userId: string): Promise<DbDocument[]> {
    const rows = await sql`
      SELECT id, original_filename, status, graph_status, created_at 
      FROM syllabus_uploads
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
    `
    return rows as DbDocument[]
  },

  async createUpload(userId: string, filename: string, sourceHash: string): Promise<{ id: string; original_filename: string }> {
    const rows = await sql`
      INSERT INTO syllabus_uploads (user_id, original_filename, source_hash, status, graph_status)
      VALUES (${userId}, ${filename}, ${sourceHash}, 'ready', 'pending')
      RETURNING id, original_filename
    `
    return rows[0] as { id: string; original_filename: string }
  }
}

