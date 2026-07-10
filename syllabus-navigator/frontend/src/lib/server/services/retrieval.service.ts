/**
 * server/services/retrieval.service.ts — grounded context + citations for chat.
 *
 * Port of backend/app/services/rag_engine.py: embed the question, fetch the
 * nearest chunks for the syllabus, and build (a) a context block to inject into
 * the prompt and (b) the citations to return to the client.
 */

import { embedText } from "@/lib/llm/embeddings"
import { ChunkRepository, type RetrievedChunk } from "../repositories/chunk.repo"
import type { CitationAPI } from "@/types/api"
import { flags } from "@/lib/config/flags"

const EMPTY_RESULT: RetrievalResult = { hasContext: false, contextBlock: "", citations: [] }

const TOP_K = 8
// Over-fetch from the vector index, then re-rank down to TOP_K. A wider candidate
// pool lets the lexical signal rescue chunks the pure-vector order ranked just
// outside the cut.
const CANDIDATE_K = TOP_K * 3
const MAX_CITATIONS = 5
const QUOTE_LEN = 500

// Weight of the lexical (keyword-overlap) signal relative to vector similarity in
// the hybrid re-rank score. Vector similarity dominates; lexical breaks ties and
// rescues exact-term matches.
const LEXICAL_WEIGHT = 0.35

/**
 * Relevance gate (cosine distance, range 0..2; lower = closer).
 * `<=>` returns cosine distance. Re-measured 2026-07-01 on real data with
 * text-embedding-3-large @ dim 2000 (scratch/test-retrieval-live.mjs) — the
 * distance distribution is much tighter than the old model's: on-topic queries
 * land ~0.54-0.74 (cross-language is the worst case) while off-topic ones sit
 * ~0.67-0.81. The old 0.9 default let EVERYTHING through (gate was dead). 0.75
 * keeps every measured on-topic query and blocks most off-topic ones; the
 * distributions overlap, so the grounded prompt's "si no consta, dilo" rule is
 * the second line of defense. If even the *closest* chunk is past this ceiling,
 * the question isn't about the syllabus → return no context (the chat answers
 * with NO_CONTEXT_MESSAGE instead of grounding on noise). Borderline tail chunks
 * past the ceiling are also dropped to cut prompt noise. Override with
 * RAG_MAX_DISTANCE; re-measure with the scratch script if the embedding model
 * or dimensions change again.
 */
const MAX_DISTANCE = Number(process.env.RAG_MAX_DISTANCE ?? "0.75")

export interface RetrievalResult {
  hasContext: boolean
  contextBlock: string
  citations: CitationAPI[]
}

export const GROUNDED_SYSTEM_PROMPT =
  "Eres Navigator, un mentor académico para estudiantes. Tu meta es ayudar al estudiante a " +
  "entender el material y a prepararse para sus cursos, no solo a darle datos. Explica con " +
  "claridad, paso a paso y con ejemplos cuando ayude, y sugiere qué repasar a continuación. " +
  "Para datos concretos del curso (fechas, porcentajes, políticas de evaluación) usa únicamente " +
  "el contexto proporcionado del sílabo; si no constan, dilo claramente y no los inventes. " +
  "Cuando uses información de un fragmento, menciónalo con su etiqueta, p. ej. [Fragmento 1]. " +
  "Mantén un tono cercano y alentador, como un buen tutor. Puedes usar el historial para " +
  "resolver referencias como 'eso' o 'el examen'."

export const NO_CONTEXT_MESSAGE =
  "No consta en tus archivos subidos: no encontré fragmentos relevantes en este sílabo."

/** Tokenize to lowercase word stems (length ≥ 3) for lexical overlap scoring. */
function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((t) => t.length >= 3)
}

/**
 * Hybrid re-rank: combine vector similarity with query/chunk keyword overlap.
 * Cosine distance is 0..2 (lower = closer) → vectorSim = 1 - distance/2 in [0,1].
 * lexical = fraction of distinct query terms present in the chunk, in [0,1].
 * Returns chunks sorted by the blended score (desc). Pure + deterministic.
 */
export function rerankChunks<T extends { content: string; distance: number }>(
  query: string,
  chunks: T[],
): T[] {
  const queryTerms = new Set(tokenize(query))
  const scored = chunks.map((c) => {
    const vectorSim = 1 - c.distance / 2
    let lexical = 0
    if (queryTerms.size > 0) {
      const chunkTerms = new Set(tokenize(c.content))
      let hits = 0
      for (const t of queryTerms) if (chunkTerms.has(t)) hits++
      lexical = hits / queryTerms.size
    }
    return { c, score: vectorSim + LEXICAL_WEIGHT * lexical }
  })
  // Stable sort by score desc; ties keep original (vector) order.
  return scored
    .map((s, i) => ({ ...s, i }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((s) => s.c)
}

/** Apply the relevance gate, re-rank, then build context/citations. */
function buildResult(all: RetrievedChunk[], withSource: boolean, query: string): RetrievalResult {
  // Relevance gate: the gate is on raw vector distance (closest candidate). If even
  // the nearest chunk is past the ceiling, the question is off-topic → no context.
  const nearest = all.reduce((min, c) => Math.min(min, c.distance), Infinity)
  const passing =
    all.length === 0 || nearest > MAX_DISTANCE ? [] : all.filter((c) => c.distance <= MAX_DISTANCE)

  // Re-rank the survivors with the hybrid signal, then keep TOP_K.
  const chunks = rerankChunks(query, passing).slice(0, TOP_K)

  if (chunks.length === 0) {
    return { hasContext: false, contextBlock: "", citations: [] }
  }

  const contextParts: string[] = []
  const citations: CitationAPI[] = []

  chunks.forEach((c, i) => {
    const tag = withSource && c.source_name ? `[${c.source_name}]` : ""
    contextParts.push(`[Fragmento ${i + 1}]${tag}\n${c.content}`)
    citations.push({
      chunk_id: c.id,
      page_start: c.page_start,
      page_end: c.page_end,
      char_start: c.char_start ?? null,
      char_end: c.char_end ?? null,
      quote: c.content.length > QUOTE_LEN ? `${c.content.slice(0, QUOTE_LEN)}...` : c.content,
      source_name: c.source_name ?? null,
      syllabus_id: c.syllabus_id ?? null,
      source_type: (c.source_type as CitationAPI["source_type"]) ?? null,
      source_url: c.source_url ?? null,
      // PRIVATE-store docs: hand the client the authed proxy route, not the raw
      // (non-fetchable) blob URL. Citation links open it with #page=N.
      file_url: c.file_url && c.syllabus_id ? `/api/upload/${c.syllabus_id}/file` : null,
    })
  })

  return {
    hasContext: true,
    contextBlock: contextParts.join("\n\n"),
    citations: citations.slice(0, MAX_CITATIONS),
  }
}

export const RetrievalService = {
  async retrieve(syllabusId: string, question: string): Promise<RetrievalResult> {
    if (!flags.ragEnabled) return EMPTY_RESULT
    const queryEmbedding = await embedText(question)
    const all = await ChunkRepository.search(syllabusId, queryEmbedding, CANDIDATE_K)
    return buildResult(all, false, question)
  },

  /** Retrieve relevant context across ALL the user's courses (unbound chat). */
  async retrieveForUser(userId: string, question: string): Promise<RetrievalResult> {
    if (!flags.ragEnabled) return EMPTY_RESULT
    const queryEmbedding = await embedText(question)
    const all = await ChunkRepository.searchByUser(userId, queryEmbedding, CANDIDATE_K)
    return buildResult(all, true, question)
  },

  /** Retrieve context scoped to every document in one course (course mind map). */
  async retrieveForCourse(
    userId: string,
    courseId: string,
    question: string,
  ): Promise<RetrievalResult> {
    if (!flags.ragEnabled) return EMPTY_RESULT
    const queryEmbedding = await embedText(question)
    const all = await ChunkRepository.searchByCourse(userId, courseId, queryEmbedding, CANDIDATE_K)
    return buildResult(all, true, question)
  },

  /** Compose the user turn with the retrieved context (matches rag_engine.py). */
  buildGroundedUserContent(contextBlock: string, question: string): string {
    return `Contexto del sílabo:\n${contextBlock}\n\nPregunta: ${question}`
  },
}
