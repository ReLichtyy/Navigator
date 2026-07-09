/**
 * graph-gen.test.ts — label rule enforcement (≤4 words, no ":").
 *
 * The rule is schema-enforced: NodeSchema's transform shortens any violating
 * label deterministically and preserves the original text in `detail`, so a
 * misbehaving LLM can never surface a long/colon label in the mind map.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const ragJson = vi.hoisted(() => vi.fn())
vi.mock("@/lib/llm/rag-generate", () => ({
  ragJson,
  extractJson: (s: string) => s,
}))

import { extractGraphFromText } from "@/lib/server/rag/graph-gen"

function graphWith(nodes: object[]) {
  return JSON.stringify({
    layout: "radial",
    nodes,
    prerequisites: [],
    crossLinks: [],
  })
}

const root = { id: "r", label: "DOM", level: 1, parentId: null, weight: 100, detail: null }

describe("extractGraphFromText — label rule (≤4 words, no ':')", () => {
  beforeEach(() => ragJson.mockReset())

  it("keeps compliant labels and their detail untouched", async () => {
    ragJson.mockResolvedValue(
      graphWith([
        root,
        {
          id: "n1",
          label: "API de Nodos",
          level: 2,
          parentId: "r",
          weight: null,
          detail: "Insertar elementos con appendChild o insertBefore",
        },
      ]),
    )
    const g = await extractGraphFromText("texto")
    const n1 = g.topics.find((t) => t.externalId === "n1")!
    expect(n1.label).toBe("API de Nodos")
    expect(n1.detail).toBe("Insertar elementos con appendChild o insertBefore")
  })

  it("splits a colon label: keeps the segment after ':' and moves the original to detail", async () => {
    ragJson.mockResolvedValue(
      graphWith([
        root,
        {
          id: "n1",
          label: "Insertar elementos en el DOM: API Nodos",
          level: 2,
          parentId: "r",
          weight: null,
          detail: null,
        },
      ]),
    )
    const g = await extractGraphFromText("texto")
    const n1 = g.topics.find((t) => t.externalId === "n1")!
    expect(n1.label).toBe("API Nodos")
    expect(n1.detail).toBe("Insertar elementos en el DOM: API Nodos")
  })

  it("truncates a >4-word label to 4 words and preserves the original in detail", async () => {
    ragJson.mockResolvedValue(
      graphWith([
        root,
        {
          id: "n1",
          label: "Navegar a través de elementos DOM adyacentes",
          level: 2,
          parentId: "r",
          weight: null,
          detail: null,
        },
      ]),
    )
    const g = await extractGraphFromText("texto")
    const n1 = g.topics.find((t) => t.externalId === "n1")!
    expect(n1.label.split(/\s+/).length).toBeLessThanOrEqual(4)
    expect(n1.label).toBe("Navegar a través de")
    expect(n1.detail).toBe("Navegar a través de elementos DOM adyacentes")
  })

  it("does not overwrite an existing detail when shortening", async () => {
    ragJson.mockResolvedValue(
      graphWith([
        root,
        {
          id: "n1",
          label: "Eventos: burbujeo y captura de eventos",
          level: 2,
          parentId: "r",
          weight: null,
          detail: "Propagación de eventos en dos fases",
        },
      ]),
    )
    const g = await extractGraphFromText("texto")
    const n1 = g.topics.find((t) => t.externalId === "n1")!
    expect(n1.label).toBe("burbujeo y captura de")
    expect(n1.detail).toBe("Propagación de eventos en dos fases")
  })

  it("strips a trailing period", async () => {
    ragJson.mockResolvedValue(
      graphWith([
        root,
        { id: "n1", label: "Eventos del DOM.", level: 2, parentId: "r", weight: null, detail: null },
      ]),
    )
    const g = await extractGraphFromText("texto")
    const n1 = g.topics.find((t) => t.externalId === "n1")!
    expect(n1.label).toBe("Eventos del DOM")
  })

  it("every label in a mixed graph ends up ≤4 words with no ':'", async () => {
    ragJson.mockResolvedValue(
      graphWith([
        { ...root, label: "Manipulación del DOM con JavaScript moderno" },
        {
          id: "n1",
          label: "Selección de elementos: querySelector y querySelectorAll",
          level: 2,
          parentId: "r",
          weight: null,
          detail: null,
        },
        { id: "n2", label: "Eventos del DOM", level: 2, parentId: "r", weight: null, detail: null },
      ]),
    )
    const g = await extractGraphFromText("texto")
    for (const t of g.topics) {
      expect(t.label.includes(":")).toBe(false)
      expect(t.label.trim().split(/\s+/).length).toBeLessThanOrEqual(4)
    }
  })
})
