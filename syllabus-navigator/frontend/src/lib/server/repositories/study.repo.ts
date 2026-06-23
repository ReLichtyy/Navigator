import { sql } from "@/lib/db"
import type { StudySet } from "../rag/study-gen"

export const StudyRepository = {
  /** Cached study set for a syllabus, or undefined if never generated. */
  async get(syllabusId: string): Promise<StudySet | undefined> {
    const rows = await sql`
      SELECT data FROM study_sets WHERE syllabus_id = ${syllabusId}::uuid
    `
    return (rows[0] as { data: StudySet } | undefined)?.data
  },

  /** Insert or replace the cached study set for a syllabus. */
  async upsert(syllabusId: string, data: StudySet): Promise<void> {
    await sql`
      INSERT INTO study_sets (syllabus_id, data)
      VALUES (${syllabusId}::uuid, ${JSON.stringify(data)}::jsonb)
      ON CONFLICT (syllabus_id) DO UPDATE
        SET data = EXCLUDED.data, updated_at = now()
    `
  },
}
