import { describe, it, expect } from "vitest"
import { getDocStatus } from "@/lib/ui/doc-status"

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
  it("optimistic row → Uploading, pending, no reprocess", () => {
    const sv = getDocStatus(doc({ _optimistic: true }))
    expect(sv).toMatchObject({ label: "Uploading…", tone: "pending", canReprocess: false })
  })

  it("status error → Failed, error, reprocessable, tooltip from error_message", () => {
    const sv = getDocStatus(doc({ status: "error", error_message: "boom" }))
    expect(sv).toMatchObject({ label: "Failed", tone: "error", canReprocess: true, tooltip: "boom" })
  })

  it("status pending → Processing, pending", () => {
    expect(getDocStatus(doc({ status: "pending" }))).toMatchObject({
      label: "Processing…",
      tone: "pending",
    })
  })

  it("graph failed → warn + reprocessable", () => {
    const sv = getDocStatus(doc({ graph_status: "failed", graph_error: "g" }))
    expect(sv).toMatchObject({ label: "Graph failed", tone: "warn", canReprocess: true, tooltip: "g" })
  })

  it("graph processing → Building graph, pending", () => {
    expect(getDocStatus(doc({ graph_status: "processing" }))).toMatchObject({
      label: "Building graph…",
      tone: "pending",
    })
  })

  it("fully processed → Ready, ok, not reprocessable", () => {
    expect(getDocStatus(doc())).toMatchObject({ label: "Ready", tone: "ok", canReprocess: false })
  })

  it("error tone falls back to default tooltip when none given", () => {
    expect(getDocStatus(doc({ status: "error" })).tooltip).toBe("Processing failed.")
  })
})
