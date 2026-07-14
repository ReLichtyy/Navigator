/**
 * mastery.repo.ts — topic mastery ledger (Sprint 4).
 *
 * `confidence` is an exponential moving average of quiz outcomes in [0,1] that
 * shifts toward the latest result, so it reflects "how well the student knows
 * this topic right now". topic_key is a normalized label so it survives
 * study-set/graph regeneration. Only real (uuid) users have rows — guests are
 * excluded by the users(id) FK, same as flashcard_reviews.
 */
import { sql } from "@/lib/db"
import type { StudyScope } from "./study-items.repo"

/** Weight of the newest outcome in the moving average (0..1). Higher = more reactive. */
const ALPHA = 0.4

/** Doc scope keeps syllabus_id populated (that's where the cascade lives); course scope nulls it. */
const syllabusIdOf = (scope: StudyScope) => (scope.kind === "doc" ? scope.id : null)

/** Normalize a topic label into a stable key (lowercase, collapsed whitespace). */
export function topicKey(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 160)
}

export interface MasteryRow {
  topic_key: string
  label: string
  confidence: number
  attempts: number
  correct: number
}

export interface CourseMastery {
  syllabus_id: string
  topics: number
  avg_confidence: number
  attempts: number
}

export const MasteryRepository = {
  /**
   * Apply a batch of quiz outcomes for one scope (a document or a whole course).
   * Outcomes are aggregated per topic first, then each topic's confidence is moved
   * toward the batch hit-rate by ALPHA. Upserts the row (seeding from the batch
   * when the topic is new).
   */
  async recordOutcomes(
    userId: string,
    scope: StudyScope,
    outcomes: { label: string; correct: boolean }[],
  ): Promise<void> {
    // Aggregate per topic: hits / n within this batch.
    const byTopic = new Map<string, { label: string; n: number; hits: number }>()
    for (const o of outcomes) {
      const label = o.label.trim()
      if (!label) continue
      const key = topicKey(label)
      const agg = byTopic.get(key) ?? { label, n: 0, hits: 0 }
      agg.n += 1
      agg.hits += o.correct ? 1 : 0
      byTopic.set(key, agg)
    }

    const syllabusId = syllabusIdOf(scope)
    for (const [key, agg] of byTopic) {
      const batchRate = agg.hits / agg.n
      await sql`
        INSERT INTO topic_mastery
          (user_id, scope_kind, scope_id, syllabus_id, topic_key, label, confidence, attempts, correct)
        VALUES (
          ${userId}::uuid, ${scope.kind}, ${scope.id}::uuid, ${syllabusId}::uuid,
          ${key}, ${agg.label}, ${batchRate}, ${agg.n}, ${agg.hits}
        )
        ON CONFLICT (user_id, scope_kind, scope_id, topic_key) DO UPDATE SET
          confidence = round((topic_mastery.confidence * ${1 - ALPHA} + ${batchRate} * ${ALPHA})::numeric, 3),
          attempts   = topic_mastery.attempts + ${agg.n},
          correct    = topic_mastery.correct + ${agg.hits},
          label      = EXCLUDED.label,
          updated_at = now()
      `
    }
  },

  /** Per-topic mastery for one scope (doc or whole course), strongest first. */
  async listForScope(userId: string, scope: StudyScope): Promise<MasteryRow[]> {
    const rows = await sql`
      SELECT topic_key, label, confidence::float8 AS confidence, attempts, correct
      FROM topic_mastery
      WHERE user_id = ${userId}::uuid
        AND scope_kind = ${scope.kind} AND scope_id = ${scope.id}::uuid
      ORDER BY confidence DESC, attempts DESC
    `
    return rows as MasteryRow[]
  },

  /** Mastery overview per doc-scope syllabus (the /mastery dashboard). */
  async overview(userId: string): Promise<CourseMastery[]> {
    const rows = await sql`
      SELECT syllabus_id,
             count(*)::int AS topics,
             round(avg(confidence)::numeric, 3)::float8 AS avg_confidence,
             sum(attempts)::int AS attempts
      FROM topic_mastery
      WHERE user_id = ${userId}::uuid AND syllabus_id IS NOT NULL
      GROUP BY syllabus_id
    `
    return rows as CourseMastery[]
  },
}
