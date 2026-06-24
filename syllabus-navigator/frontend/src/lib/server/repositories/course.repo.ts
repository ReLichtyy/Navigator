import { sql } from "@/lib/db"

export interface DbCourse {
  id: string
  user_id: string
  name: string
  description: string | null
  subject_tags: string[] | null
  color: string | null
  created_at: string
  updated_at: string
}

export interface CreateCourseInput {
  name: string
  description?: string | null
  subjectTags?: string[] | null
  color?: string | null
}

export const CourseRepository = {
  /** All of a user's courses, with how many documents are confirmed in each. */
  async listByUser(userId: string): Promise<(DbCourse & { document_count: number })[]> {
    const rows = await sql`
      SELECT c.*, COUNT(s.id)::int AS document_count
      FROM user_courses c
      LEFT JOIN syllabus_uploads s ON s.course_id = c.id
      WHERE c.user_id = ${userId}::uuid
      GROUP BY c.id
      ORDER BY c.name ASC
    `
    return rows as (DbCourse & { document_count: number })[]
  },

  async findByIdAndUser(courseId: string, userId: string): Promise<DbCourse | undefined> {
    const rows = await sql`
      SELECT * FROM user_courses
      WHERE id = ${courseId}::uuid AND user_id = ${userId}::uuid
    `
    return rows[0] as DbCourse | undefined
  },

  /**
   * Create a course, or return the existing one with the same (user_id, name).
   * Idempotent so the worker / "create new course" UI never collides on the
   * UNIQUE(user_id, name) constraint.
   */
  async createOrGet(userId: string, input: CreateCourseInput): Promise<DbCourse> {
    const { name, description = null, subjectTags = null, color = null } = input
    const rows = await sql`
      INSERT INTO user_courses (user_id, name, description, subject_tags, color)
      VALUES (${userId}::uuid, ${name}, ${description}, ${subjectTags}, ${color})
      ON CONFLICT (user_id, name) DO UPDATE SET updated_at = now()
      RETURNING *
    `
    return rows[0] as DbCourse
  },

  async rename(courseId: string, userId: string, name: string): Promise<DbCourse | undefined> {
    const rows = await sql`
      UPDATE user_courses
      SET name = ${name}, updated_at = now()
      WHERE id = ${courseId}::uuid AND user_id = ${userId}::uuid
      RETURNING *
    `
    return rows[0] as DbCourse | undefined
  },

  /**
   * Delete a course. Documents reference it via ON DELETE SET NULL, so they are
   * preserved and fall back to "uncategorised" rather than being deleted.
   * Returns false when the course doesn't exist / isn't owned by the user.
   */
  async deleteByIdAndUser(courseId: string, userId: string): Promise<boolean> {
    const rows = await sql`
      DELETE FROM user_courses
      WHERE id = ${courseId}::uuid AND user_id = ${userId}::uuid
      RETURNING id
    `
    return rows.length > 0
  },
}
