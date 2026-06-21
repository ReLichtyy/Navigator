/**
 * server/services/retrieval.service.ts — grounded context + citations for chat.
 *
 * Port of backend/app/services/rag_engine.py: embed the question, fetch the
 * nearest chunks for the syllabus, and build (a) a context block to inject into
 * the prompt and (b) the citations to return to the client.
 */

import { embedText } from "@/lib/llm/embeddings"
import { ChunkRepository } from "../repositories/chunk.repo"
import type { CitationAPI } from "@/types/api"

const TOP_K = 8
const MAX_CITATIONS = 5
const QUOTE_LEN = 500

export interface RetrievalResult {
  hasContext: boolean
  contextBlock: string
  citations: CitationAPI[]
}

export const GROUNDED_SYSTEM_PROMPT =
  "Eres un asistente académico. Responde usando únicamente el contexto proporcionado del " +
  "sílabo. Si la respuesta no está en el contexto, indícalo claramente. No inventes fechas, " +
  "porcentajes ni políticas de evaluación. Cuando uses información de un fragmento, menciónalo " +
  "con su etiqueta, p. ej. [Fragmento 1]. Puedes usar el historial para resolver referencias " +
  "como 'eso' o 'el examen'."

export const NO_CONTEXT_MESSAGE =
  "No consta en tus archivos subidos: no encontré fragmentos relevantes en este sílabo."

export const RetrievalService = {
  async retrieve(syllabusId: string, question: string): Promise<RetrievalResult> {
    const queryEmbedding = await embedText(question)
    const chunks = await ChunkRepository.search(syllabusId, queryEmbedding, TOP_K)

    if (chunks.length === 0) {
      return { hasContext: false, contextBlock: "", citations: [] }
    }

    const contextParts: string[] = []
    const citations: CitationAPI[] = []

    chunks.forEach((c, i) => {
      contextParts.push(`[Fragmento ${i + 1}]\n${c.content}`)
      citations.push({
        chunk_id: c.id,
        page_start: c.page_start,
        page_end: c.page_end,
        quote: c.content.length > QUOTE_LEN ? `${c.content.slice(0, QUOTE_LEN)}...` : c.content,
      })
    })

    return {
      hasContext: true,
      contextBlock: contextParts.join("\n\n"),
      citations: citations.slice(0, MAX_CITATIONS),
    }
  },

  /** Compose the user turn with the retrieved context (matches rag_engine.py). */
  buildGroundedUserContent(contextBlock: string, question: string): string {
    return `Contexto del sílabo:\n${contextBlock}\n\nPregunta: ${question}`
  },
}
