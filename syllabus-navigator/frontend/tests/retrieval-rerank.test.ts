import { describe, it, expect } from "vitest"
import { rerankChunks } from "@/lib/server/services/retrieval.service"

describe("rerankChunks (hybrid re-rank)", () => {
  it("keeps a clearly-closer vector chunk first", () => {
    const out = rerankChunks("recursión en programación", [
      { content: "tema sobre recursión y funciones", distance: 0.2 },
      { content: "texto sin relación alguna", distance: 0.9 },
    ])
    expect(out[0].content).toContain("recursión")
  })

  it("lexical overlap promotes a near-tie chunk that contains the query terms", () => {
    // Both close on vectors; only the second shares the query keyword "derivada".
    const out = rerankChunks("qué es la derivada", [
      { content: "concepto matemático general sin el término", distance: 0.5 },
      { content: "la derivada mide la tasa de cambio", distance: 0.55 },
    ])
    expect(out[0].content).toContain("derivada")
  })

  it("is stable: equal scores preserve original order", () => {
    const a = { content: "alpha", distance: 0.4 }
    const b = { content: "beta", distance: 0.4 }
    const out = rerankChunks("zzz", [a, b]) // no overlap → lexical 0 for both
    expect(out.map((c) => c.content)).toEqual(["alpha", "beta"])
  })

  it("empty query → pure vector order (no lexical signal)", () => {
    const out = rerankChunks("", [
      { content: "far", distance: 0.8 },
      { content: "near", distance: 0.1 },
    ])
    expect(out[0].content).toBe("near")
  })
})
