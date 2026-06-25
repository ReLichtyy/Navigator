/**
 * study-items.repo.ts — persistent bank of generated study items.
 *
 * Unlike study_sets.data (a replaceable bundle), the bank ACCUMULATES across
 * refreshes and is deduped by embedding similarity. This is what stops the
 * "everything repeats" problem at the root: each refresh only adds genuinely
 * NEW items, and the texts already in the bank are fed back as `excludeSeen`
 * to the next generation.
 */
import { sql } from "@/lib/db"
import { toVectorLiteral } from "@/lib/llm/embeddings"

export type StudyScope = { kind: "doc" | "course"; id: string }
export type StudyItemType = "flashcard" | "quiz" | "case" | "cloze" | "recall"

/** A novel item ready to persist (embedding already computed). */
export interface NewStudyItem {
  userId: string | null
  type: StudyItemType
  topicKey?: string | null
  difficulty: string
  payload: unknown
  dedupeText: string
  embedding: number[]
}

export interface BankItem<T = unknown> {
  id: string
  type: StudyItemType
  topicKey: string | null
  difficulty: string
  payload: T
}

// Cosine-distance cutoff for "this item already exists". distance < 0.08 ⇔
// similarity > 0.92 → near-identical → drop as a duplicate. Tuned high so only
// genuine repeats die; legitimate variants of a concept survive.
const DEDUPE_MAX_DISTANCE = 0.08

export const StudyItemsRepository = {
  /**
   * Texts already in the bank for a (scope, type), most recent first. Fed to the
   * generator as `excludeSeen` so it does not regenerate them. Capped to keep the
   * prompt bounded.
   */
  async listDedupeTexts(scope: StudyScope, type: StudyItemType, limit = 120): Promise<string[]> {
    const rows = await sql`
      SELECT dedupe_text FROM study_items
      WHERE scope_kind = ${scope.kind} AND scope_id = ${scope.id}::uuid AND type = ${type}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `
    return (rows as { dedupe_text: string }[]).map((r) => r.dedupe_text)
  },

  /**
   * Insert items, skipping any whose embedding is within DEDUPE_MAX_DISTANCE of an
   * existing item in the same (scope, type). Returns how many were actually added.
   */
  async insertDeduped(scope: StudyScope, items: NewStudyItem[]): Promise<number> {
    let inserted = 0
    for (const it of items) {
      const vec = toVectorLiteral(it.embedding)
      const near = await sql`
        SELECT 1 FROM study_items
        WHERE scope_kind = ${scope.kind} AND scope_id = ${scope.id}::uuid
          AND type = ${it.type} AND embedding IS NOT NULL
          AND (embedding <=> ${vec}::vector) < ${DEDUPE_MAX_DISTANCE}
        LIMIT 1
      `
      if (near.length > 0) continue // duplicate → skip

      await sql`
        INSERT INTO study_items
          (user_id, scope_kind, scope_id, type, topic_key, difficulty, payload, dedupe_text, embedding, source)
        VALUES (
          ${it.userId}::uuid,
          ${scope.kind}, ${scope.id}::uuid, ${it.type}, ${it.topicKey ?? null},
          ${it.difficulty}, ${JSON.stringify(it.payload)}::jsonb, ${it.dedupeText},
          ${vec}::vector, 'study-gen'
        )
      `
      inserted++
    }
    return inserted
  },

  /** Most-recent payloads of a given type from the bank (to assemble a fresh set). */
  async listRecent<T = unknown>(
    scope: StudyScope,
    type: StudyItemType,
    limit: number,
  ): Promise<BankItem<T>[]> {
    const rows = await sql`
      SELECT id, type, topic_key, difficulty, payload FROM study_items
      WHERE scope_kind = ${scope.kind} AND scope_id = ${scope.id}::uuid AND type = ${type}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `
    return (rows as { id: string; type: StudyItemType; topic_key: string | null; difficulty: string; payload: T }[]).map(
      (r) => ({ id: r.id, type: r.type, topicKey: r.topic_key, difficulty: r.difficulty, payload: r.payload }),
    )
  },
}
