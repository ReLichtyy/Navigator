/**
 * server/rag/retrieval/hybrid.ts — hybrid retrieval (dense + lexical) with
 * Reciprocal Rank Fusion, and topic-targeted retrieval for the generators.
 *
 * Step 2 of the Study Engine rework: instead of feeding generators the whole
 * concatenated text truncated to 24k chars (which always studies the head of the
 * document), retrieve the most relevant chunks PER target topic via dense+lexical
 * fusion. Covers the whole syllabus by topic and catches exact terms/formulas the
 * embedding alone misses.
 */

import { embedText } from "@/lib/llm/embeddings"
import { ChunkRepository, type RetrievedChunk } from "../../repositories/chunk.repo"
import { logError } from "@/lib/observability/logger"

// RRF constant. Higher = flatter weighting of rank position (standard ≈ 60).
const RRF_K = 60

/**
 * Reciprocal Rank Fusion: merge several ranked lists into one. Each chunk scores
 * Σ 1/(RRF_K + rank_in_list); chunks appearing high in multiple lists win. Dedupes
 * by chunk id, keeping the first object seen. Pure + deterministic.
 */
export function rrfFuse(lists: RetrievedChunk[][], k = RRF_K): RetrievedChunk[] {
  const score = new Map<string, number>()
  const obj = new Map<string, RetrievedChunk>()
  for (const list of lists) {
    list.forEach((c, rank) => {
      score.set(c.id, (score.get(c.id) ?? 0) + 1 / (k + rank))
      if (!obj.has(c.id)) obj.set(c.id, c)
    })
  }
  return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => obj.get(id)!)
}

export type GenScope = { kind: "doc"; id: string } | { kind: "course"; id: string; userId: string }

async function denseAndLexical(
  scope: GenScope,
  query: string,
  queryEmbedding: number[],
  candidates: number,
): Promise<RetrievedChunk[]> {
  if (scope.kind === "doc") {
    const [dense, lex] = await Promise.all([
      ChunkRepository.search(scope.id, queryEmbedding, candidates),
      ChunkRepository.searchLexical(scope.id, query, queryEmbedding, candidates),
    ])
    return rrfFuse([dense, lex])
  }
  const [dense, lex] = await Promise.all([
    ChunkRepository.searchByCourse(scope.userId, scope.id, queryEmbedding, candidates),
    ChunkRepository.searchLexicalByCourse(
      scope.userId,
      scope.id,
      query,
      queryEmbedding,
      candidates,
    ),
  ])
  return rrfFuse([dense, lex])
}

export interface TopicRetrievalOptions {
  /** Chunks kept per topic after fusion. */
  perTopic?: number
  /** Hard cap on the assembled context length (chars). */
  maxChars?: number
}

/** Split the context budget fairly across normalized, distinct target topics. */
export function allocateCoverage(
  topics: string[],
  maxChars: number,
): { topic: string; maxChars: number }[] {
  const seen = new Set<string>()
  const labels: string[] = []
  for (const raw of topics) {
    const topic = raw.trim()
    const key = topic.toLocaleLowerCase()
    if (!topic || seen.has(key)) continue
    seen.add(key)
    labels.push(topic)
  }
  if (labels.length === 0) return []
  const budget = Math.max(0, Math.trunc(maxChars))
  const base = Math.floor(budget / labels.length)
  let remainder = budget - base * labels.length
  return labels.map((topic) => {
    const extra = remainder > 0 ? 1 : 0
    remainder -= extra
    return { topic, maxChars: base + extra }
  })
}

/**
 * Build a study context by retrieving the top chunks for EACH topic (hybrid) and
 * concatenating them under topic headers, deduped across topics. Returns null when
 * nothing could be retrieved (no topics, or embeddings not ready yet) so callers
 * can fall back to the full concatenated text.
 */
export async function buildContextByTopics(
  scope: GenScope,
  topics: string[],
  opts: TopicRetrievalOptions = {},
): Promise<string | null> {
  const perTopic = opts.perTopic ?? 6
  const maxChars = opts.maxChars ?? 24_000
  const allocations = allocateCoverage(topics, maxChars)
  if (allocations.length === 0) return null

  try {
    const results = await Promise.all(
      allocations.map(async ({ topic, maxChars: topicChars }) => {
        const queryEmbedding = await embedText(topic)
        const fused = (
          await denseAndLexical(scope, topic, queryEmbedding, perTopic * 3)
        ).slice(0, perTopic)
        return { topic, topicChars, fused }
      }),
    )
    const seen = new Set<string>()
    const sections: string[] = []
    for (const { topic, topicChars, fused } of results) {
      const fresh = fused.filter((c) => !seen.has(c.id))
      fresh.forEach((c) => seen.add(c.id))
      if (fresh.length === 0) continue
      sections.push(
        `## ${topic}\n\n${fresh
          .map((c) => c.content)
          .join("\n\n")
          .slice(0, topicChars)}`,
      )
    }
    if (sections.length === 0) return null
    return sections.join("\n\n")
  } catch (err) {
    logError("rag.retrieval.by_topics.error", {
      error: err instanceof Error ? err.message : String(err),
    })
    return null // fall back to concatenated text
  }
}
