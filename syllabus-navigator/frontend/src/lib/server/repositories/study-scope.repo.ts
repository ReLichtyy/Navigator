/**
 * study-scope.repo.ts — teardown for everything keyed by a study scope.
 *
 * The scoped study tables (study_items, quiz_review, quiz_seen, topic_mastery,
 * flashcard_reviews) identify their owner with (scope_kind, scope_id) and NOT a
 * foreign key — scope_id points at either a document or a course, so it can't be
 * one. Doc-scope rows still cascade (they keep a syllabus_id FK), but course-scope
 * rows have nothing to cascade from: deleting a course used to leave its whole
 * question bank, Repaso queue, mastery ledger and SRS state behind forever.
 */
import { sql } from "@/lib/db"
import type { StudyScope } from "./study-items.repo"

export const StudyScopeRepository = {
  /** Delete every study row belonging to a scope. Returns rows removed per table. */
  async purge(scope: StudyScope): Promise<Record<string, number>> {
    const kind = scope.kind
    const id = scope.id

    const [items, review, seen, mastery, srs] = await Promise.all([
      sql`DELETE FROM study_items
          WHERE scope_kind = ${kind} AND scope_id = ${id}::uuid RETURNING id`,
      sql`DELETE FROM quiz_review
          WHERE scope_kind = ${kind} AND scope_id = ${id}::uuid RETURNING id`,
      sql`DELETE FROM quiz_seen
          WHERE scope_kind = ${kind} AND scope_id = ${id}::uuid RETURNING item_id`,
      sql`DELETE FROM topic_mastery
          WHERE scope_kind = ${kind} AND scope_id = ${id}::uuid RETURNING id`,
      sql`DELETE FROM flashcard_reviews
          WHERE scope_kind = ${kind} AND scope_id = ${id}::uuid RETURNING id`,
    ])

    return {
      study_items: items.length,
      quiz_review: review.length,
      quiz_seen: seen.length,
      topic_mastery: mastery.length,
      flashcard_reviews: srs.length,
    }
  },
}
