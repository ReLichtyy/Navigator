/**
 * server/services/graph-ask.service.ts — inline "ask about this mind map".
 *
 * Powers the mind-map question bar (design Navigator v3): a student types a
 * question about the map (or taps a refine chip) and gets a short grounded
 * answer rendered in a bubble on the canvas — no navigation to the chat.
 *
 * Grounding reuses the RAG retrieval path: course maps retrieve across every
 * document in the course; per-doc ("sin curso") maps retrieve from that one
 * syllabus. The answer is deliberately concise — it's an overlay, not a chat.
 */

import { chatCompletion } from "@/lib/llm"
import { RetrievalService, NO_CONTEXT_MESSAGE } from "./retrieval.service"
import { ApiErrorResponse } from "@/lib/server/utils/auth-helpers"
import { CourseGraphRepository } from "../repositories/course-graph.repo"

/** Refine actions fired by the quick chips under the question bar. */
export type GraphAskRefine = "concise" | "detail" | "translate" | "regenerate"

export interface GraphAskParams {
  userId: string
  courseId?: string | null
  syllabusId?: string | null
  question: string
  refine?: GraphAskRefine | null
  /** The previous answer a refine chip acts on (concise / detail / translate). */
  previousAnswer?: string | null
  /** Target language for the "translate" refine (e.g. "inglés", "portugués"). */
  lang?: string | null
}

const SYSTEM_PROMPT =
  "Eres Navigator, un mentor académico. El estudiante está viendo un MAPA MENTAL de los temas " +
  "de su curso y te pregunta sobre él. Responde de forma breve y clara (2-4 frases), enfocándote " +
  "en cómo se conectan o estructuran los temas. Usa únicamente el contexto del sílabo para datos " +
  "concretos; si no consta, dilo con honestidad y no lo inventes. No uses etiquetas de fragmento " +
  "en la respuesta: escribe en prosa natural, como un buen tutor."

// Refine chips rewrite the ask instead of retrieving again from scratch: they
// transform the previous answer, so they don't need (or want) fresh grounding.
function refineInstruction(refine: GraphAskRefine, prev: string, lang: string): string {
  switch (refine) {
    case "concise":
      return `Reescribe la siguiente respuesta de forma más concisa, en 1-2 frases, sin perder lo esencial:\n\n${prev}`
    case "detail":
      return `Amplía la siguiente respuesta con más detalle y algún ejemplo útil, manteniéndola clara:\n\n${prev}`
    case "translate":
      return `Traduce la siguiente respuesta al ${lang || "inglés"}, conservando el tono de tutor:\n\n${prev}`
    default:
      return prev
  }
}

export const GraphAskService = {
  async ask(params: GraphAskParams): Promise<{ answer: string }> {
    const { userId, courseId, syllabusId, refine, previousAnswer, lang } = params
    const question = params.question.trim()

    // Refine chips (concise / detail / translate) transform the last answer —
    // no retrieval, just a rewrite. "regenerate" falls through to a fresh ask.
    if (refine && refine !== "regenerate" && (previousAnswer ?? "").trim()) {
      const res = await chatCompletion(
        [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: refineInstruction(refine, previousAnswer!.trim(), lang ?? ""),
          },
        ],
        { temperature: 0.3, maxTokens: 500 },
      )
      return { answer: res.content.trim() }
    }

    if (!question) throw new ApiErrorResponse("Escribe una pregunta sobre el mapa.", 400)

    const courseGraph = courseId ? await CourseGraphRepository.get(courseId) : undefined
    const selectedDocIds = courseGraph?.source_doc_ids.length
      ? courseGraph.source_doc_ids
      : undefined
    const retrieval = courseId
      ? await RetrievalService.retrieveForCourse(userId, courseId, question, selectedDocIds)
      : syllabusId
        ? await RetrievalService.retrieve(syllabusId, question)
        : null

    if (!retrieval) throw new ApiErrorResponse("No hay un mapa seleccionado.", 400)
    if (!retrieval.hasContext) return { answer: NO_CONTEXT_MESSAGE }

    const userContent = RetrievalService.buildGroundedUserContent(retrieval.contextBlock, question)
    const res = await chatCompletion(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      { temperature: 0.3, maxTokens: 500 },
    )
    return { answer: res.content.trim() }
  },
}
