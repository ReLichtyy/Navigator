import { sql } from "@/lib/db"
import type { ExtractedEvent } from "../rag/schedule-gen"

export interface ScheduleEvent {
  id: string
  syllabus_id: string
  course_name: string
  event_type: string
  title: string
  description: string | null
  event_date: string | null // yyyy-mm-dd
  week_label: string | null
  weight_percent: number | null
  /** Course term start (yyyy-mm-dd) — lets services resolve "Semana N" → date. */
  term_start: string | null
}

export const ScheduleRepository = {
  /** Replace all schedule events for a syllabus (idempotent re-runs). */
  async replaceEvents(syllabusId: string, events: ExtractedEvent[]): Promise<number> {
    await sql`DELETE FROM schedule_events WHERE syllabus_id = ${syllabusId}::uuid`
    if (events.length === 0) return 0

    // user_id is denormalized for cross-course "my agenda" queries.
    const owner = await sql`SELECT user_id FROM syllabus_uploads WHERE id = ${syllabusId}::uuid`
    const userId = (owner[0] as { user_id?: string })?.user_id
    if (!userId) return 0

    for (const e of events) {
      await sql`
        INSERT INTO schedule_events
          (syllabus_id, user_id, event_type, title, description, event_date, week_label, weight_percent)
        VALUES (
          ${syllabusId}::uuid, ${userId}, ${e.type}, ${e.title}, ${e.description},
          ${e.date}::date, ${e.weekLabel}, ${e.weightPercent}
        )
      `
    }
    return events.length
  },

  /** All events for one syllabus, ordered (dated first, then undated). */
  async listBySyllabus(syllabusId: string): Promise<ScheduleEvent[]> {
    return (await sql`
      SELECT se.id, se.syllabus_id, su.original_filename AS course_name,
             se.event_type, se.title, se.description,
             to_char(se.event_date, 'YYYY-MM-DD') AS event_date,
             se.week_label, se.weight_percent,
             to_char(uc.term_start, 'YYYY-MM-DD') AS term_start
      FROM schedule_events se
      JOIN syllabus_uploads su ON su.id = se.syllabus_id
      LEFT JOIN user_courses uc ON uc.id = su.course_id
      WHERE se.syllabus_id = ${syllabusId}::uuid
      ORDER BY se.event_date ASC NULLS LAST, se.created_at ASC
    `) as ScheduleEvent[]
  },

  /**
   * The user's agenda across ALL their courses. Includes future dated events
   * (from `fromDate`) plus undated/weekly items so the chat can still reason
   * about week-labelled schedules.
   */
  async listAgendaByUser(userId: string, fromDate: string, limit = 60): Promise<ScheduleEvent[]> {
    return (await sql`
      SELECT se.id, se.syllabus_id, su.original_filename AS course_name,
             se.event_type, se.title, se.description,
             to_char(se.event_date, 'YYYY-MM-DD') AS event_date,
             se.week_label, se.weight_percent,
             to_char(uc.term_start, 'YYYY-MM-DD') AS term_start
      FROM schedule_events se
      JOIN syllabus_uploads su ON su.id = se.syllabus_id
      LEFT JOIN user_courses uc ON uc.id = su.course_id
      WHERE se.user_id = ${userId}
        AND (se.event_date IS NULL OR se.event_date >= ${fromDate}::date)
      ORDER BY se.event_date ASC NULLS LAST, se.created_at ASC
      LIMIT ${limit}
    `) as ScheduleEvent[]
  },
}
