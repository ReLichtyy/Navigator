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

/** Cosine distance (1 − cosine similarity) between two equal-length vectors. */
function cosineDistance(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb)
  return denom === 0 ? 1 : 1 - dot / denom
}

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
   *
   * Two-pass dedup, optimized for latency: (1) drop in-batch near-duplicates in
   * memory (cheap, avoids one roundtrip per pair), then (2) insert the survivors
   * concurrently, each as a single "INSERT … WHERE NOT EXISTS(near)" statement so
   * the existence check and the write are one roundtrip (was two, sequential).
   */
  async insertDeduped(scope: StudyScope, items: NewStudyItem[]): Promise<number> {
    // Pass 1 — collapse near-identical items within this batch.
    const unique: NewStudyItem[] = []
    for (const it of items) {
      if (unique.some((u) => cosineDistance(u.embedding, it.embedding) < DEDUPE_MAX_DISTANCE)) continue
      unique.push(it)
    }

    // Pass 2 — concurrent insert-if-not-near-an-existing-item.
    const results = await Promise.all(
      unique.map((it) => {
        const vec = toVectorLiteral(it.embedding)
        return sql`
          INSERT INTO study_items
            (user_id, scope_kind, scope_id, type, topic_key, difficulty, payload, dedupe_text, embedding, source)
          SELECT
            ${it.userId}::uuid,
            ${scope.kind}, ${scope.id}::uuid, ${it.type}, ${it.topicKey ?? null},
            ${it.difficulty}, ${JSON.stringify(it.payload)}::jsonb, ${it.dedupeText},
            ${vec}::vector, 'study-gen'
          WHERE NOT EXISTS (
            SELECT 1 FROM study_items
            WHERE scope_kind = ${scope.kind} AND scope_id = ${scope.id}::uuid
              AND type = ${it.type} AND embedding IS NOT NULL
              AND (embedding <=> ${vec}::vector) < ${DEDUPE_MAX_DISTANCE}
          )
          RETURNING id
        `
      }),
    )
    return results.filter((r) => r.length > 0).length
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

  /**
   * Bank items for one stage: filtered by difficulty, excluding ids already served
   * this run, most-recent first. Powers the staged quiz (15 per stage drawn lazily).
   */
  async listForStage<T = unknown>(
    scope: StudyScope,
    type: StudyItemType,
    difficulty: string,
    limit: number,
    excludeIds: string[] = [],
  ): Promise<BankItem<T>[]> {
    const rows = await sql`
      SELECT id, type, topic_key, difficulty, payload FROM study_items
      WHERE scope_kind = ${scope.kind} AND scope_id = ${scope.id}::uuid
        AND type = ${type} AND difficulty = ${difficulty}
        AND id <> ALL(${excludeIds}::uuid[])
      ORDER BY created_at DESC
      LIMIT ${limit}
    `
    return (rows as { id: string; type: StudyItemType; topic_key: string | null; difficulty: string; payload: T }[]).map(
      (r) => ({ id: r.id, type: r.type, topicKey: r.topic_key, difficulty: r.difficulty, payload: r.payload }),
    )
  },

  /** How many items of a type exist for a scope (used to enforce the bank cap). */
  async countByType(scope: StudyScope, type: StudyItemType): Promise<number> {
    const rows = await sql`
      SELECT count(*)::int AS n FROM study_items
      WHERE scope_kind = ${scope.kind} AND scope_id = ${scope.id}::uuid AND type = ${type}
    `
    return (rows as { n: number }[])[0]?.n ?? 0
  },
}
