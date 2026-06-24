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

  /** Cached whole-course study set, or undefined if never generated. */
  async getByCourse(courseId: string): Promise<StudySet | undefined> {
    const rows = await sql`
      SELECT data FROM course_study_sets WHERE course_id = ${courseId}::uuid
    `
    return (rows[0] as { data: StudySet } | undefined)?.data
  },

  /** Insert or replace the cached whole-course study set. */
  async upsertByCourse(courseId: string, data: StudySet): Promise<void> {
    await sql`
      INSERT INTO course_study_sets (course_id, data)
      VALUES (${courseId}::uuid, ${JSON.stringify(data)}::jsonb)
      ON CONFLICT (course_id) DO UPDATE
        SET data = EXCLUDED.data, updated_at = now()
    `
  },
}
