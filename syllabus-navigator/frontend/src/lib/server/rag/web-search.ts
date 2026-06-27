/**
 * server/rag/web-search.ts — real web search for study-material generation.
 *
 * Uses the OpenAI Responses API `web_search_preview` tool: the model runs live
 * web searches and returns a grounded summary. We feed that summary back into the
 * study-set generators as SUPPLEMENTARY context (clearly labelled), so the user can
 * enrich quizzes/flashcards/summaries with up-to-date external material beyond their
 * own PDFs. Best-effort: any failure returns null and generation proceeds doc-only.
 */

import OpenAI from "openai"
import { logError, logInfo } from "@/lib/observability/logger"

let _client: OpenAI | null = null
function getClient(): OpenAI {
  if (!_client) {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) throw new Error("OPENAI_API_KEY is not configured")
    _client = new OpenAI({ apiKey })
  }
  return _client
}

// The web_search_preview tool is served on the 4o/4.1 families via the Responses
// API. Pin a known-good model (overridable) rather than the global DEFAULT_MODEL,
// which may point at a model that doesn't expose the tool.
const WEB_MODEL = process.env.WEB_SEARCH_MODEL || "gpt-4o-mini"

// Keep the supplementary block bounded so it never dominates the doc material.
const MAX_WEB_CHARS = 6_000

/**
 * Run a web search and return a concise, grounded summary to use as extra study
 * context, or null when search is unavailable / yields nothing. `lang` nudges the
 * output to match the course material's language (e.g. "es").
 */
export async function webSearchContext(query: string, lang = "es"): Promise<string | null> {
  const q = query.trim()
  if (q.length < 3) return null

  const client = getClient()
  const prompt =
    `Eres un asistente de investigación académica. Busca en la web información actual, ` +
    `confiable y relevante sobre el siguiente tema de estudio y redacta apuntes concisos ` +
    `(conceptos clave, definiciones, ejemplos y datos verificables) que sirvan para generar ` +
    `material de estudio. No inventes; básate solo en lo encontrado. Responde en el idioma ` +
    `"${lang}". Incluye al final una lista breve de las fuentes (título y URL).\n\nTema: ${q}`

  try {
    const res = await client.responses.create({
      model: WEB_MODEL,
      tools: [{ type: "web_search_preview" }],
      input: prompt,
    })
    const text = (res.output_text ?? "").trim()
    if (text.length < 40) return null
    logInfo("rag.web_search.ok", { chars: text.length })
    return text.slice(0, MAX_WEB_CHARS)
  } catch (err) {
    logError("rag.web_search.error", { error: err instanceof Error ? err.message : String(err) })
    return null
  }
}

/** Wrap web notes as a clearly-delimited supplementary block appended to doc material. */
export function appendWebContext(courseText: string, webText: string): string {
  return (
    `${courseText}\n\n` +
    `===== CONTEXTO WEB SUPLEMENTARIO (búsqueda en línea; trátalo como material fuente adicional) =====\n` +
    `${webText}\n` +
    `===== FIN DEL CONTEXTO WEB =====`
  )
}
