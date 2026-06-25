import { describe, it, expect } from "vitest"
import { rrfFuse } from "@/lib/server/rag/retrieval/hybrid"
import { scoreTargets } from "@/lib/server/rag/orchestrator/router"
import type { RetrievedChunk } from "@/lib/server/repositories/chunk.repo"

function chunk(id: string): RetrievedChunk {
  return {
    id,
    chunk_index: 0,
    content: id,
    page_start: null,
    page_end: null,
    char_start: null,
    char_end: null,
    distance: 0,
  }
}

describe("rrfFuse (Reciprocal Rank Fusion)", () => {
  it("ranks a chunk high in both lists above singletons", () => {
    const dense = [chunk("a"), chunk("b"), chunk("c")]
    const lexical = [chunk("b"), chunk("d")]
    const fused = rrfFuse([dense, lexical])
    // b appears top-ish in both → should win.
    expect(fused[0].id).toBe("b")
    // dedupes by id.
    expect(fused.map((c) => c.id).sort()).toEqual(["a", "b", "c", "d"])
  })

  it("preserves order of a single list", () => {
    const fused = rrfFuse([[chunk("a"), chunk("b"), chunk("c")]])
    expect(fused.map((c) => c.id)).toEqual(["a", "b", "c"])
  })
})

describe("scoreTargets (Router priority)", () => {
  it("puts a low-mastery topic above a mastered one of equal weight", () => {
    const weighted = [
      { label: "Recursión", weight: 50 },
      { label: "Listas", weight: 50 },
    ]
    const mastery = new Map([["recursión", 0.1], ["listas", 0.9]])
    const targets = scoreTargets(weighted, mastery, 0, 0)
    expect(targets[0].label).toBe("Recursión")
    expect(targets[0].priority).toBeGreaterThan(targets[1].priority)
  })

  it("an unseen topic (mastery 0) outranks a mastered heavier one", () => {
    const weighted = [
      { label: "Punteros", weight: 40 },
      { label: "Sintaxis", weight: 60 },
    ]
    const mastery = new Map([["sintaxis", 1]]) // punteros unseen → 0
    const targets = scoreTargets(weighted, mastery, 0, 0)
    expect(targets[0].label).toBe("Punteros")
  })

  it("urgency + srs lift all priorities equally (tie-break stays on weight/mastery)", () => {
    const weighted = [{ label: "Tema", weight: 100 }]
    const base = scoreTargets(weighted, new Map(), 0, 0)[0].priority
    const lifted = scoreTargets(weighted, new Map(), 1, 1)[0].priority
    expect(lifted).toBeGreaterThan(base)
  })
})
