import { describe, it, expect } from "vitest"
import { getDocStatus, isChatReady, NEEDS_OCR_HINT } from "@/lib/ui/doc-status"

function doc(over: Record<string, unknown> = {}) {
  return {
    id: "1",
    original_filename: "x.pdf",
    status: "processed",
    graph_status: "ready",
    created_at: "2026-06-01",
    ...over,
  } as any
}

describe("getDocStatus", () => {
  it("optimistic row → Subiendo, pending, no reprocess", () => {
    const sv = getDocStatus(doc({ _optimistic: true }))
    expect(sv).toMatchObject({ label: "Subiendo…", tone: "pending", canReprocess: false })
  })

  it("status error → clear label, error, reprocessable, tooltip from error_message", () => {
    const sv = getDocStatus(doc({ status: "error", error_message: "boom" }))
    expect(sv).toMatchObject({
      label: "No se procesó",
      tone: "error",
      canReprocess: true,
      tooltip: "boom",
    })
  })

  it("status needs_ocr → Escaneado, warn, not reprocessable, OCR hint (not 'Error')", () => {
    const sv = getDocStatus(doc({ status: "needs_ocr" }))
    expect(sv).toMatchObject({
      label: "Escaneado",
      tone: "warn",
      canReprocess: false,
      tooltip: NEEDS_OCR_HINT,
    })
    expect(sv.label).not.toMatch(/error/i)
  })

  it("status pending → Procesando, pending", () => {
    expect(getDocStatus(doc({ status: "pending" }))).toMatchObject({
      label: "Procesando…",
      tone: "pending",
    })
  })

  it("graph failed → warn + reprocessable", () => {
    const sv = getDocStatus(doc({ graph_status: "failed", graph_error: "g" }))
    expect(sv).toMatchObject({
      label: "Listo · mapa falló",
      tone: "warn",
      canReprocess: true,
      tooltip: "g",
    })
  })

  it("graph processing → Generando mapa, pending, reprocessable", () => {
    expect(getDocStatus(doc({ graph_status: "processing" }))).toMatchObject({
      label: "Generando mapa…",
      tone: "pending",
      canReprocess: true,
    })
  })

  it("fully processed → Listo, ok, reprocessable", () => {
    expect(getDocStatus(doc())).toMatchObject({ label: "Listo", tone: "ok", canReprocess: true })
  })

  it("error tone falls back to default tooltip when none given", () => {
    expect(getDocStatus(doc({ status: "error" })).tooltip).toBe(
      "No se pudo procesar el documento. Reintenta el procesamiento.",
    )
  })

  it("isChatReady: only processed docs are chat-ready", () => {
    expect(isChatReady(doc())).toBe(true)
    expect(isChatReady(doc({ status: "needs_ocr" }))).toBe(false)
    expect(isChatReady(doc({ status: "pending" }))).toBe(false)
    expect(isChatReady(doc({ _optimistic: true }))).toBe(false)
  })
})
