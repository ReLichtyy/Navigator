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
const MAX_CITATIONS = 5
const QUOTE_LEN = 500

/**
 * Relevance gate (cosine distance, range 0..2; lower = closer).
 * `<=>` returns cosine distance. Measured on real data (Spanish syllabus):
 * on-topic queries land ~0.65-0.84 (cross-language inflates this) while clearly
 * off-topic ones sit ~0.94+. 0.9 splits the gap. If even the *closest* chunk is
 * past this ceiling, the question isn't about the syllabus → return no context
 * (the chat then answers with NO_CONTEXT_MESSAGE instead of grounding on noise).
 * Borderline tail chunks past the ceiling are also dropped to cut prompt noise.
 * Override with RAG_MAX_DISTANCE.
 */
const MAX_DISTANCE = Number(process.env.RAG_MAX_DISTANCE ?? "0.9")

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

/** Apply the relevance gate + build context/citations from ranked chunks. */
function buildResult(all: RetrievedChunk[], withSource: boolean): RetrievalResult {
  // Relevance gate: if the closest chunk is past the ceiling, off-topic → no
  // context. Otherwise drop the noisy tail.
  const chunks =
    all.length === 0 || all[0].distance > MAX_DISTANCE
      ? []
      : all.filter((c) => c.distance <= MAX_DISTANCE)

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
      quote: c.content.length > QUOTE_LEN ? `${c.content.slice(0, QUOTE_LEN)}...` : c.content,
      source_name: c.source_name ?? null,
      syllabus_id: c.syllabus_id ?? null,
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
    const all = await ChunkRepository.search(syllabusId, queryEmbedding, TOP_K)
    return buildResult(all, false)
  },

  /** Retrieve relevant context across ALL the user's courses (unbound chat). */
  async retrieveForUser(userId: string, question: string): Promise<RetrievalResult> {
    if (!flags.ragEnabled) return EMPTY_RESULT
    const queryEmbedding = await embedText(question)
    const all = await ChunkRepository.searchByUser(userId, queryEmbedding, TOP_K)
    return buildResult(all, true)
  },

  /** Compose the user turn with the retrieved context (matches rag_engine.py). */
  buildGroundedUserContent(contextBlock: string, question: string): string {
    return `Contexto del sílabo:\n${contextBlock}\n\nPregunta: ${question}`
  },
}
