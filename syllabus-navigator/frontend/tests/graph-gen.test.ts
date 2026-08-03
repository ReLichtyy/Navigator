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

  it("truncates an overlong model detail before schema validation", async () => {
    const detail = "x".repeat(220)
    ragJson.mockResolvedValue(
      graphWith([
        root,
        {
          id: "n1",
          label: "API de Nodos",
          level: 2,
          parentId: "r",
          weight: null,
          detail,
        },
      ]),
    )

    const g = await extractGraphFromText("texto")

    expect(g.topics.find((t) => t.externalId === "n1")?.detail).toBe(detail.slice(0, 140))
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
        {
          id: "n1",
          label: "Eventos del DOM.",
          level: 2,
          parentId: "r",
          weight: null,
          detail: null,
        },
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

describe("extractGraphFromText — refinement limits (structure hygiene)", () => {
  beforeEach(() => ragJson.mockReset())

  const childCount = (
    topics: { externalId: string; parentExternalId: string | null }[],
    id: string,
  ) => topics.filter((t) => t.parentExternalId === id).length

  it("collapses a non-root single-child chain, preserving the child label as detail", async () => {
    ragJson.mockResolvedValue(
      graphWith([
        { id: "r", label: "Tema", level: 1, parentId: null, weight: 100, detail: null },
        { id: "a", label: "Rama A", level: 2, parentId: "r", weight: null, detail: null },
        { id: "a1", label: "Sub A", level: 3, parentId: "a", weight: null, detail: null },
        { id: "c", label: "Rama C", level: 2, parentId: "r", weight: null, detail: null },
      ]),
    )
    const g = await extractGraphFromText("t")
    const ids = g.topics.map((t) => t.externalId)
    expect(ids).not.toContain("a1") // the only child was merged up
    expect(g.topics.find((t) => t.externalId === "a")!.detail).toBe("Sub A")
    // no non-root node is left with exactly one child
    for (const t of g.topics) {
      if (t.parentExternalId) expect(childCount(g.topics, t.externalId)).not.toBe(1)
    }
  })

  it("drops a duplicate sibling (case-insensitive) and its subtree", async () => {
    ragJson.mockResolvedValue(
      graphWith([
        { id: "r", label: "Tema", level: 1, parentId: null, weight: 100, detail: null },
        { id: "x1", label: "Redes", level: 2, parentId: "r", weight: null, detail: null },
        { id: "x2", label: "redes", level: 2, parentId: "r", weight: null, detail: null },
        { id: "x2c", label: "Hijo", level: 3, parentId: "x2", weight: null, detail: null },
        { id: "y", label: "Otro", level: 2, parentId: "r", weight: null, detail: null },
      ]),
    )
    const g = await extractGraphFromText("t")
    const ids = g.topics.map((t) => t.externalId)
    expect(ids).toContain("x1")
    expect(ids).not.toContain("x2")
    expect(ids).not.toContain("x2c")
  })

  it("caps nesting depth at 4 levels", async () => {
    ragJson.mockResolvedValue(
      graphWith([
        { id: "r", label: "Tema", level: 1, parentId: null, weight: 100, detail: null },
        { id: "a", label: "Rama A", level: 2, parentId: "r", weight: null, detail: null },
        { id: "a2", label: "Rama B", level: 2, parentId: "r", weight: null, detail: null },
        { id: "b", label: "L3 uno", level: 3, parentId: "a", weight: null, detail: null },
        { id: "b2", label: "L3 dos", level: 3, parentId: "a", weight: null, detail: null },
        { id: "c", label: "L4 uno", level: 4, parentId: "b", weight: null, detail: null },
        { id: "c2", label: "L4 dos", level: 4, parentId: "b", weight: null, detail: null },
        { id: "d", label: "L5 uno", level: 5, parentId: "c", weight: null, detail: null },
        { id: "d2", label: "L5 dos", level: 5, parentId: "c", weight: null, detail: null },
      ]),
    )
    const g = await extractGraphFromText("t")
    for (const t of g.topics) expect(t.level).toBeLessThanOrEqual(4)
    expect(g.topics.map((t) => t.externalId)).not.toContain("d")
  })
})
