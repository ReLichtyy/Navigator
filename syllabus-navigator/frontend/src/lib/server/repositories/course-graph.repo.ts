import { sql } from "@/lib/db"
import type { LayoutKind } from "./graph.repo"

/**
 * Whole-course mind map, ONE row per course (JSONB payload in the exact shape
 * the client consumes). Unlike per-document graphs (topics/topic_dependencies
 * rows, generated at ingest), this is generated on demand from the documents
 * the user selected in the "Editar mapa" drawer; `source_doc_ids` persists
 * that selection.
 */
export interface CourseGraphData {
  layout: LayoutKind
  nodes: {
    id: string
    label: string
    weight_percent: number
    level: number
    parent_id: string | null
    detail: string | null
    color: string | null
  }[]
  edges: { source: string; target: string }[]
  crossLinks: { source: string; target: string; label: string }[]
}

export type CourseGraphStatus = "pending" | "processing" | "ready" | "stale" | "failed"

export interface DbCourseGraph {
  course_id: string
  data: CourseGraphData | null
  source_doc_ids: string[]
  status: CourseGraphStatus
  error: string | null
}

export const CourseGraphRepository = {
  async get(courseId: string): Promise<DbCourseGraph | undefined> {
    const rows = await sql`
      SELECT course_id, data, source_doc_ids, status, error
      FROM course_graphs WHERE course_id = ${courseId}::uuid
    `
    return rows[0] as DbCourseGraph | undefined
  },

  /** Mark a (re)generation in flight, persisting the doc selection immediately. */
  async markProcessing(courseId: string, sourceDocIds: string[]): Promise<void> {
    await sql`
      INSERT INTO course_graphs (course_id, source_doc_ids, status, error, updated_at)
      VALUES (${courseId}::uuid, ${sourceDocIds}::uuid[], 'processing', NULL, now())
      ON CONFLICT (course_id) DO UPDATE
        SET source_doc_ids = EXCLUDED.source_doc_ids,
            status = 'processing', error = NULL, updated_at = now()
    `
  },

  async saveData(courseId: string, data: CourseGraphData): Promise<void> {
    await sql`
      UPDATE course_graphs
      SET data = ${JSON.stringify(data)}::jsonb, status = 'ready', error = NULL, updated_at = now()
      WHERE course_id = ${courseId}::uuid
    `
  },

  async markFailed(courseId: string, error: string): Promise<void> {
    await sql`
      UPDATE course_graphs
      SET status = 'failed', error = ${error.slice(0, 500)}, updated_at = now()
      WHERE course_id = ${courseId}::uuid
    `
  },

  /** Keep the last visible map, but flag that its source documents changed. */
  async markStale(courseId: string): Promise<void> {
    await sql`
      UPDATE course_graphs
      SET status = CASE WHEN data IS NULL THEN 'pending' ELSE 'stale' END,
          error = NULL, updated_at = now()
      WHERE course_id = ${courseId}::uuid
    `
  },

  /** Replace the JSONB payload with a user-edited graph (manual mind-map edits). */
  async replaceData(courseId: string, data: CourseGraphData): Promise<void> {
    await sql`
      INSERT INTO course_graphs (course_id, data, status, error, updated_at)
      VALUES (${courseId}::uuid, ${JSON.stringify(data)}::jsonb, 'ready', NULL, now())
      ON CONFLICT (course_id) DO UPDATE
        SET data = EXCLUDED.data, status = 'ready', error = NULL, updated_at = now()
    `
  },
}
