/**
 * study-stats.repo.ts — flashcard review recording + study streak stats.
 * Backs the sidebar streak card (UI-13) and Modo repaso spaced repetition.
 *
 * Only real (uuid) users can record reviews — flashcard_reviews.user_id FKs
 * users(id); guests are excluded by that constraint.
 */
import { sql } from "@/lib/db"
import { streakFromDates } from "@/lib/ui/streak"

/** Leitner interval (days) per box. Box 0 = same day, grows from there. */
const BOX_DAYS = [0, 1, 3, 7, 16, 35]

export interface StudyStats {
  streakDays: number
  cardsThisWeek: number
}

export const StudyStatsRepository = {
  /** Record a flashcard review, advancing/resetting its Leitner box. */
  async recordReview(
    userId: string,
    syllabusId: string,
    cardKey: string,
    known: boolean,
  ): Promise<void> {
    const existing = await sql`
      SELECT box FROM flashcard_reviews
      WHERE user_id = ${userId}::uuid AND syllabus_id = ${syllabusId}::uuid AND card_key = ${cardKey}
    `
    const prevBox = (existing[0] as { box?: number } | undefined)?.box ?? 0
    const box = known ? Math.min(prevBox + 1, BOX_DAYS.length - 1) : 0
    const dueDays = BOX_DAYS[box]

    await sql`
      INSERT INTO flashcard_reviews
        (user_id, syllabus_id, card_key, box, due_at, last_result, reviewed_at)
      VALUES (
        ${userId}::uuid, ${syllabusId}::uuid, ${cardKey}, ${box},
        now() + (${dueDays} || ' days')::interval, ${known ? "known" : "again"}, now()
      )
      ON CONFLICT (user_id, syllabus_id, card_key) DO UPDATE
        SET box = EXCLUDED.box,
            due_at = EXCLUDED.due_at,
            last_result = EXCLUDED.last_result,
            reviewed_at = now()
    `
  },

  /**
   * Spaced-repetition pressure for a syllabus: how many tracked cards are due now
   * vs total tracked. Feeds the Router priority + the "today session" planner.
   * Returns {due:0,total:0} for guests / untracked syllabi.
   */
  async srsPressure(userId: string, syllabusId: string): Promise<{ due: number; total: number }> {
    const rows = await sql`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE due_at <= now())::int AS due
      FROM flashcard_reviews
      WHERE user_id = ${userId}::uuid AND syllabus_id = ${syllabusId}::uuid
    `
    const r = (rows[0] as { total?: number; due?: number } | undefined) ?? {}
    return { due: r.due ?? 0, total: r.total ?? 0 }
  },

  /** Card keys due for review now, most-overdue first (planner "Modo repaso"). */
  async listDue(userId: string, syllabusId: string, limit = 30): Promise<string[]> {
    const rows = await sql`
      SELECT card_key FROM flashcard_reviews
      WHERE user_id = ${userId}::uuid AND syllabus_id = ${syllabusId}::uuid AND due_at <= now()
      ORDER BY due_at ASC
      LIMIT ${limit}
    `
    return (rows as { card_key: string }[]).map((r) => r.card_key)
  },

  /** Study streak (consecutive days) + cards reviewed in the last 7 days. */
  async getStats(userId: string): Promise<StudyStats> {
    const weekRows = await sql`
      SELECT count(*)::int AS n
      FROM flashcard_reviews
      WHERE user_id = ${userId}::uuid AND reviewed_at >= now() - interval '7 days'
    `
    const cardsThisWeek = (weekRows[0] as { n?: number } | undefined)?.n ?? 0

    const dayRows = await sql`
      SELECT DISTINCT to_char(reviewed_at, 'YYYY-MM-DD') AS d
      FROM flashcard_reviews
      WHERE user_id = ${userId}::uuid AND reviewed_at >= now() - interval '90 days'
    `
    const dates = (dayRows as { d: string }[]).map((r) => r.d)
    const todayIso = new Date().toISOString().slice(0, 10)

    return { streakDays: streakFromDates(dates, todayIso), cardsThisWeek }
  },
}
