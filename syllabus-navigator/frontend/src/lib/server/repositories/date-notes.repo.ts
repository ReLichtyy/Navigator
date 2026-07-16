/**
 * date-notes.repo.ts — per-user free-form notes attached to an agenda date.
 * Every method is scoped by user_id so a user can only read/mutate their own
 * notes (ownership enforced in the WHERE clause, never trusted from input).
 * Backs the agenda day Sheet. Table: date_notes (see schema.sql).
 */
import { sql } from "@/lib/db"

export interface DateNote {
  id: string
  note_date: string // yyyy-mm-dd
  title: string | null
  color: string | null
  body: string
  created_at: string
  updated_at: string
}

export const DateNoteRepository = {
  /** All of the user's notes for one day, oldest first. */
  async listByDate(userId: string, date: string): Promise<DateNote[]> {
    return (await sql`
      SELECT id, to_char(note_date, 'YYYY-MM-DD') AS note_date, title, color, body, created_at, updated_at
      FROM date_notes
      WHERE user_id = ${userId}::uuid AND note_date = ${date}::date
      ORDER BY created_at ASC
    `) as DateNote[]
  },

  /** The user's most recent notes across all dates, newest first. Powers the Knowledge quick-notes panel. */
  async listRecent(userId: string, limit: number): Promise<DateNote[]> {
    return (await sql`
      SELECT id, to_char(note_date, 'YYYY-MM-DD') AS note_date, title, color, body, created_at, updated_at
      FROM date_notes
      WHERE user_id = ${userId}::uuid
      ORDER BY created_at DESC
      LIMIT ${limit}
    `) as DateNote[]
  },

  /** Distinct dates (yyyy-mm-dd) the user has at least one note on. Powers calendar markers. */
  async listDates(userId: string): Promise<string[]> {
    const rows = await sql`
      SELECT DISTINCT to_char(note_date, 'YYYY-MM-DD') AS note_date
      FROM date_notes
      WHERE user_id = ${userId}::uuid
      ORDER BY note_date ASC
    `
    return rows.map((r) => (r as { note_date: string }).note_date)
  },

  /** Create a note for the user on the given day. */
  async create(
    userId: string,
    date: string,
    body: string,
    metadata: { title?: string; color?: string } = {},
  ): Promise<DateNote> {
    const rows = await sql`
      INSERT INTO date_notes (user_id, note_date, body, title, color)
      VALUES (${userId}::uuid, ${date}::date, ${body}, ${metadata.title ?? null}, ${metadata.color ?? null})
      RETURNING id, to_char(note_date, 'YYYY-MM-DD') AS note_date, title, color, body, created_at, updated_at
    `
    return rows[0] as DateNote
  },

  /** Edit a note the user owns. Returns null if it does not exist / isn't theirs. */
  async update(
    userId: string,
    id: string,
    updates: { body?: string; title?: string; color?: string },
  ): Promise<DateNote | null> {
    const rows = await sql`
      UPDATE date_notes
      SET body = COALESCE(${updates.body ?? null}, body),
          title = COALESCE(${updates.title ?? null}, title),
          color = COALESCE(${updates.color ?? null}, color),
          updated_at = now()
      WHERE id = ${id}::uuid AND user_id = ${userId}::uuid
      RETURNING id, to_char(note_date, 'YYYY-MM-DD') AS note_date, title, color, body, created_at, updated_at
    `
    return (rows[0] as DateNote) ?? null
  },

  /** Delete a note the user owns. Returns false if nothing was deleted. */
  async remove(userId: string, id: string): Promise<boolean> {
    const rows = await sql`
      DELETE FROM date_notes
      WHERE id = ${id}::uuid AND user_id = ${userId}::uuid
      RETURNING id
    `
    return rows.length > 0
  },
}
