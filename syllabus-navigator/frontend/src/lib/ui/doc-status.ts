/**
 * doc-status.ts — pure mapping from a syllabus upload to its display status.
 * Extracted from the Knowledge Base window so it is unit-testable (UI-4).
 */
import type { SyllabusUploadAPI } from "@/lib/api"

export type DocTone = "ok" | "error" | "warn" | "pending"

export interface DocStatusView {
  label: string
  tone: DocTone
  tooltip?: string
  canReprocess: boolean
}

/** Message shown for a scanned/no-text PDF. Single source of truth (UI + tooltip). */
export const NEEDS_OCR_HINT =
  "Este PDF es escaneado; sube una versión digital (con texto seleccionable) o espera al OCR."

export function getDocStatus(doc: SyllabusUploadAPI & { _optimistic?: boolean }): DocStatusView {
  if (doc._optimistic) return { label: "Subiendo…", tone: "pending", canReprocess: false }

  if (doc.status === "needs_ocr") {
    return {
      label: "Escaneado",
      tone: "warn",
      tooltip: NEEDS_OCR_HINT,
      canReprocess: false,
    }
  }
  if (doc.status === "error") {
    return {
      label: "No se procesó",
      tone: "error",
      tooltip: doc.error_message ?? "No se pudo procesar el documento. Reintenta el procesamiento.",
      canReprocess: true,
    }
  }
  if (doc.status === "pending") {
    return { label: "Procesando…", tone: "pending", canReprocess: false }
  }

  // status === "processed" → the document is already usable for chat; the graph
  // is a secondary stage, so these states stay non-blocking.
  if (doc.graph_status === "failed") {
    return {
      label: "Listo · mapa falló",
      tone: "warn",
      tooltip: doc.graph_error ?? "El documento está listo, pero el mapa no se pudo generar.",
      canReprocess: true,
    }
  }
  if (doc.graph_status === "pending" || doc.graph_status === "processing") {
    return { label: "Generando mapa…", tone: "pending", canReprocess: true }
  }
  return { label: "Listo", tone: "ok", canReprocess: true }
}

/** True when the document is fully indexed and usable as chat context. */
export function isChatReady(doc: SyllabusUploadAPI & { _optimistic?: boolean }): boolean {
  return !doc._optimistic && doc.status === "processed"
}
