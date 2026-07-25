import { sql } from "@/lib/db"
import type { AcademicInventory } from "../rag/inventory-gen"

export interface StoredInventory {
  syllabus_id: string
  original_filename: string
  fingerprint: string
  version: number
  data: AcademicInventory
}

export const InventoryRepository = {
  async save(syllabusId: string, fingerprint: string, data: AcademicInventory): Promise<void> {
    await sql`
      INSERT INTO document_inventories (syllabus_id, fingerprint, version, status, data, error)
      VALUES (${syllabusId}::uuid, ${fingerprint}, 1, 'ready', ${JSON.stringify(data)}::jsonb, NULL)
      ON CONFLICT (syllabus_id) DO UPDATE SET
        fingerprint = EXCLUDED.fingerprint,
        version = document_inventories.version + 1,
        status = 'ready',
        data = EXCLUDED.data,
        error = NULL,
        updated_at = now()
    `
  },

  async markFailed(syllabusId: string, fingerprint: string, error: string): Promise<void> {
    await sql`
      INSERT INTO document_inventories (syllabus_id, fingerprint, status, error)
      VALUES (${syllabusId}::uuid, ${fingerprint}, 'failed', ${error.slice(0, 1000)})
      ON CONFLICT (syllabus_id) DO UPDATE SET
        fingerprint = EXCLUDED.fingerprint,
        status = 'failed',
        error = EXCLUDED.error,
        updated_at = now()
    `
  },

  async getForDocuments(
    userId: string,
    courseId: string,
    docIds: string[],
  ): Promise<StoredInventory[]> {
    if (docIds.length === 0) return []
    const rows = await sql`
      SELECT di.syllabus_id, su.original_filename, di.fingerprint, di.version, di.data
      FROM document_inventories di
      JOIN syllabus_uploads su ON su.id = di.syllabus_id
      WHERE su.user_id = ${userId} AND su.course_id = ${courseId}::uuid
        AND di.status = 'ready' AND di.syllabus_id = ANY(${docIds}::uuid[])
      ORDER BY su.original_filename
    `
    return rows as StoredInventory[]
  },
}
