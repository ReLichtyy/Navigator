import { describe, it, expect } from "vitest"
import {
  rootIds,
  applyBranchEdits,
  type GraphNodeDTO,
  type GraphEdgeDTO,
  type BranchEdit,
} from "@/lib/ui/graph-edit"

// a, b roots; c child of a; d child of b and c
const nodes: GraphNodeDTO[] = [
  { id: "a", label: "Álgebra", weight_percent: 20 },
  { id: "b", label: "Cálculo", weight_percent: 30 },
  { id: "c", label: "Matrices", weight_percent: 10 },
  { id: "d", label: "Optimización", weight_percent: 40 },
]
const edges: GraphEdgeDTO[] = [
  { source: "a", target: "c" },
  { source: "b", target: "d" },
  { source: "c", target: "d" },
]

const keepAll: BranchEdit[] = [
  { id: "a", label: "Álgebra" },
  { id: "b", label: "Cálculo" },
]

describe("rootIds", () => {
  it("returns the in-degree-0 nodes", () => {
    expect(rootIds(nodes, edges)).toEqual(new Set(["a", "b"]))
  })

  it("falls back to every node when nothing has in-degree 0 (cycle)", () => {
    const cyc: GraphEdgeDTO[] = [
      { source: "a", target: "b" },
      { source: "b", target: "a" },
    ]
    const two = nodes.slice(0, 2)
    expect(rootIds(two, cyc)).toEqual(new Set(["a", "b"]))
  })
})

describe("applyBranchEdits", () => {
  it("renames a root and preserves everything else (incl. weights)", () => {
    const out = applyBranchEdits(nodes, edges, [
      { id: "a", label: "  Álgebra lineal " },
      { id: "b", label: "Cálculo" },
    ])
    expect(out.nodes).toHaveLength(4)
    expect(out.nodes.find((n) => n.id === "a")).toEqual({
      id: "a",
      label: "Álgebra lineal",
      weight_percent: 20,
    })
    expect(out.edges).toEqual(edges)
  })

  it("an emptied label keeps the original", () => {
    const out = applyBranchEdits(nodes, edges, [
      { id: "a", label: "   " },
      { id: "b", label: "Cálculo" },
    ])
    expect(out.nodes.find((n) => n.id === "a")?.label).toBe("Álgebra")
  })

  it("deleting a root removes its node and every touching edge, keeps its subtree", () => {
    const out = applyBranchEdits(nodes, edges, [{ id: "b", label: "Cálculo" }])
    expect(out.nodes.map((n) => n.id).sort()).toEqual(["b", "c", "d"])
    // a→c gone; b→d and c→d survive
    expect(out.edges).toEqual([
      { source: "b", target: "d" },
      { source: "c", target: "d" },
    ])
  })

  it("does not delete non-root nodes even if absent from the edits", () => {
    const out = applyBranchEdits(nodes, edges, keepAll)
    expect(out.nodes.map((n) => n.id).sort()).toEqual(["a", "b", "c", "d"])
  })

  it("adds new branches with unique temp ids and no edges", () => {
    const out = applyBranchEdits(nodes, edges, [
      ...keepAll,
      { id: null, label: " Probabilidad " },
      { id: null, label: "Estadística" },
    ])
    const added = out.nodes.filter((n) => n.id.startsWith("new-"))
    expect(added).toEqual([
      { id: "new-1", label: "Probabilidad" },
      { id: "new-2", label: "Estadística" },
    ])
    expect(out.edges).toEqual(edges)
  })

  it("temp ids skip collisions with existing node ids", () => {
    const withClash: GraphNodeDTO[] = [...nodes, { id: "new-1", label: "Ya existe" }]
    const out = applyBranchEdits(withClash, edges, [
      ...keepAll,
      { id: "new-1", label: "Ya existe" },
      { id: null, label: "Nueva" },
    ])
    expect(out.nodes.find((n) => n.label === "Nueva")?.id).toBe("new-2")
  })

  it("ignores blank new branches", () => {
    const out = applyBranchEdits(nodes, edges, [...keepAll, { id: null, label: "  " }])
    expect(out.nodes).toHaveLength(4)
  })
})
