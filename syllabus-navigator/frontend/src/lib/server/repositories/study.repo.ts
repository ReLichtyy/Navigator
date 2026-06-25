import { sql } from "@/lib/db"
import type { StudySet } from "../rag/study-gen"

export const StudyRepository = {
  /**
   * Cached study set for a syllabus, or undefined if never generated OR stale.
   * Versioned cache: a stored set is only reused when its content_fingerprint and
   * schema_version both still match — re-uploading the PDF or bumping the schema
   * invalidates it automatically.
   */
  async get(
    syllabusId: string,
    fingerprint: string,
    version: number,
  ): Promise<StudySet | undefined> {
    const rows = await sql`
      SELECT data FROM study_sets
      WHERE syllabus_id = ${syllabusId}::uuid
        AND content_fingerprint = ${fingerprint}
        AND schema_version = ${version}
    `
    return (rows[0] as { data: StudySet } | undefined)?.data
  },

  /** Insert or replace the cached study set for a syllabus (with cache version keys). */
  async upsert(
    syllabusId: string,
    data: StudySet,
    fingerprint: string,
    version: number,
  ): Promise<void> {
    await sql`
      INSERT INTO study_sets (syllabus_id, data, content_fingerprint, schema_version)
      VALUES (${syllabusId}::uuid, ${JSON.stringify(data)}::jsonb, ${fingerprint}, ${version})
      ON CONFLICT (syllabus_id) DO UPDATE
        SET data = EXCLUDED.data,
            content_fingerprint = EXCLUDED.content_fingerprint,
            schema_version = EXCLUDED.schema_version,
            updated_at = now()
    `
  },

  /** Cached whole-course study set, or undefined if never generated OR stale. */
  async getByCourse(
    courseId: string,
    fingerprint: string,
    version: number,
  ): Promise<StudySet | undefined> {
    const rows = await sql`
      SELECT data FROM course_study_sets
      WHERE course_id = ${courseId}::uuid
        AND content_fingerprint = ${fingerprint}
        AND schema_version = ${version}
    `
    return (rows[0] as { data: StudySet } | undefined)?.data
  },

  /** Insert or replace the cached whole-course study set (with cache version keys). */
  async upsertByCourse(
    courseId: string,
    data: StudySet,
    fingerprint: string,
    version: number,
  ): Promise<void> {
    await sql`
      INSERT INTO course_study_sets (course_id, data, content_fingerprint, schema_version)
      VALUES (${courseId}::uuid, ${JSON.stringify(data)}::jsonb, ${fingerprint}, ${version})
      ON CONFLICT (course_id) DO UPDATE
        SET data = EXCLUDED.data,
            content_fingerprint = EXCLUDED.content_fingerprint,
            schema_version = EXCLUDED.schema_version,
            updated_at = now()
    `
  },
}
