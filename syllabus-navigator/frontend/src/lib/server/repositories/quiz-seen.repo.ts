/**
 * quiz-seen.repo.ts — per-user ledger of quiz bank items already served.
 *
 * The bank (study_items) is shared per scope, but consumption is per user: once a
 * user has been served an item it goes here, and future stages exclude it so a
 * later session never repeats questions. Failed items additionally live in
 * quiz_review (re-surfaced via Repaso); this is the broader "don't serve again" set.
 */
import { sql } from "@/lib/db"
import type { StudyScope } from "./study-items.repo"

export const QuizSeenRepository = {
  /** Record bank item ids as served to a user+scope (idempotent). */
  async markSeen(userId: string, scope: StudyScope, itemIds: string[]): Promise<void> {
    const ids = Array.from(new Set(itemIds.filter(Boolean)))
    if (ids.length === 0) return
    await sql`
      INSERT INTO quiz_seen (user_id, scope_kind, scope_id, item_id)
      SELECT ${userId}::uuid, ${scope.kind}, ${scope.id}::uuid, id
      FROM unnest(${ids}::uuid[]) AS id
      ON CONFLICT (user_id, scope_kind, scope_id, item_id) DO NOTHING
    `
  },

  /** Bank ids already served to a user+scope → excluded from future stages. */
  async seenItemIds(userId: string, scope: StudyScope): Promise<string[]> {
    const rows = await sql`
      SELECT item_id FROM quiz_seen
      WHERE user_id = ${userId}::uuid AND scope_kind = ${scope.kind} AND scope_id = ${scope.id}::uuid
    `
    return (rows as { item_id: string }[]).map((r) => r.item_id)
  },

  /**
   * Forget every served item for a user+scope. Used when the bank is exhausted
   * (all items seen) so the staged quiz can recycle older questions instead of
   * hard-stopping — the "rotación" fallback once the bank hits its target size.
   */
  async clearForScope(userId: string, scope: StudyScope): Promise<void> {
    await sql`
      DELETE FROM quiz_seen
      WHERE user_id = ${userId}::uuid AND scope_kind = ${scope.kind} AND scope_id = ${scope.id}::uuid
    `
  },
}
