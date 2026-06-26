/**
 * quiz-review.repo.ts — per-user "Repaso" queue of quiz questions answered wrong.
 *
 * A failed quiz question leaves the quiz (excluded from future stages by item_id)
 * and lands here; Repaso renders exactly this queue. Answering it correctly in
 * Repaso resolves it (drops out of the queue). Keyed by a stable hash of the
 * question text so the same question never duplicates.
 */
import { sql } from "@/lib/db"
import type { StudyScope } from "./study-items.repo"
import type { QuizQuestion } from "../rag/study-gen"

/** A stored review question carries its bank id so the quiz can keep excluding it. */
export type ReviewQuestion = QuizQuestion & { id?: string }

/** Stable hash of a question's text (mirrors the client's flashcard/question keying). */
export function questionKey(question: string): string {
  let h = 0
  for (let i = 0; i < question.length; i++) {
    h = (Math.imul(31, h) + question.charCodeAt(i)) | 0
  }
  return `q${(h >>> 0).toString(36)}`
}

export const QuizReviewRepository = {
  /** Add (or re-open) a failed quiz question for a user+scope. */
  async add(userId: string, scope: StudyScope, q: ReviewQuestion): Promise<void> {
    const key = questionKey(q.question)
    await sql`
      INSERT INTO quiz_review (user_id, scope_kind, scope_id, item_id, question_key, topic, payload)
      VALUES (
        ${userId}::uuid, ${scope.kind}, ${scope.id}::uuid, ${q.id ?? null},
        ${key}, ${q.topic ?? null}, ${JSON.stringify(q)}::jsonb
      )
      ON CONFLICT (user_id, scope_kind, scope_id, question_key) DO UPDATE SET
        resolved_at = NULL,
        payload     = EXCLUDED.payload,
        item_id     = COALESCE(quiz_review.item_id, EXCLUDED.item_id)
    `
  },

  /** Open (unresolved) review questions for a user+scope, oldest first. */
  async listOpen(userId: string, scope: StudyScope): Promise<ReviewQuestion[]> {
    const rows = await sql`
      SELECT payload FROM quiz_review
      WHERE user_id = ${userId}::uuid AND scope_kind = ${scope.kind}
        AND scope_id = ${scope.id}::uuid AND resolved_at IS NULL
      ORDER BY created_at
    `
    return (rows as { payload: ReviewQuestion }[]).map((r) => r.payload)
  },

  /** Bank ids of open review questions → excluded from quiz stages (failed ⇒ leaves quiz). */
  async openItemIds(userId: string, scope: StudyScope): Promise<string[]> {
    const rows = await sql`
      SELECT item_id FROM quiz_review
      WHERE user_id = ${userId}::uuid AND scope_kind = ${scope.kind}
        AND scope_id = ${scope.id}::uuid AND resolved_at IS NULL AND item_id IS NOT NULL
    `
    return (rows as { item_id: string }[]).map((r) => r.item_id)
  },

  /** Mark a review question resolved (answered correctly in Repaso). */
  async resolve(userId: string, scope: StudyScope, question: string): Promise<void> {
    const key = questionKey(question)
    await sql`
      UPDATE quiz_review SET resolved_at = now()
      WHERE user_id = ${userId}::uuid AND scope_kind = ${scope.kind}
        AND scope_id = ${scope.id}::uuid AND question_key = ${key}
    `
  },

  /** Count of open review questions for a user+scope (badges / empty-state). */
  async countOpen(userId: string, scope: StudyScope): Promise<number> {
    const rows = await sql`
      SELECT count(*)::int AS n FROM quiz_review
      WHERE user_id = ${userId}::uuid AND scope_kind = ${scope.kind}
        AND scope_id = ${scope.id}::uuid AND resolved_at IS NULL
    `
    return (rows as { n: number }[])[0]?.n ?? 0
  },
}
