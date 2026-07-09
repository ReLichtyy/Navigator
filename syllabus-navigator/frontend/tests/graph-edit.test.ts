import { describe, it, expect } from "vitest"
import {
  rootIds,
  applyBranchEdits,
  applyTreeEdits,
  type GraphNodeDTO,
  type GraphEdgeDTO,
  type BranchEdit,
  type TreeNodeDTO,
  type CrossLinkDTO,
  type TreeEdit,
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

  it("emits branches in edits order (reorder), non-roots after in original order", () => {
    const out = applyBranchEdits(nodes, edges, [
      { id: "b", label: "Cálculo" },
      { id: "a", label: "Álgebra" },
    ])
    expect(out.nodes.map((n) => n.id)).toEqual(["b", "a", "c", "d"])
    expect(out.edges).toEqual(edges)
  })

  it("new branches take their drawer position, not the end", () => {
    const out = applyBranchEdits(nodes, edges, [
      { id: "b", label: "Cálculo" },
      { id: null, label: "Probabilidad" },
      { id: "a", label: "Álgebra" },
    ])
    expect(out.nodes.map((n) => n.id)).toEqual(["b", "new-1", "a", "c", "d"])
  })

  it("a duplicated id in the edits is emitted once (first occurrence wins)", () => {
    const out = applyBranchEdits(nodes, edges, [
      { id: "a", label: "Primera" },
      { id: "a", label: "Segunda" },
      { id: "b", label: "Cálculo" },
    ])
    expect(out.nodes.filter((n) => n.id === "a")).toHaveLength(1)
    expect(out.nodes.find((n) => n.id === "a")?.label).toBe("Primera")
  })
})

// 3-level tree fixture: root -> a, b; a -> c, d; c -> e (leaf, has detail)
const treeNodes: TreeNodeDTO[] = [
  { id: "a", label: "Álgebra", level: 1, parentId: null, weight_percent: 30 },
  { id: "b", label: "Cálculo", level: 1, parentId: null, weight_percent: 70 },
  { id: "c", label: "Matrices", level: 2, parentId: "a" },
  { id: "d", label: "Vectores", level: 2, parentId: "a" },
  { id: "e", label: "Determinantes", level: 3, parentId: "c", detail: "Regla de Sarrus" },
]
const treeCrossLinks: CrossLinkDTO[] = [{ source: "d", target: "b", label: "requiere" }]

describe("applyTreeEdits", () => {
  it("renames a node at any depth", () => {
    const out = applyTreeEdits(treeNodes, treeCrossLinks, [
      { type: "rename", id: "e", label: "  Determinantes 2x2  " },
    ])
    expect(out.nodes.find((n) => n.id === "e")?.label).toBe("Determinantes 2x2")
  })

  it("a blank rename is a no-op", () => {
    const out = applyTreeEdits(treeNodes, treeCrossLinks, [
      { type: "rename", id: "e", label: "   " },
    ])
    expect(out.nodes.find((n) => n.id === "e")?.label).toBe("Determinantes")
  })

  it("delete cascades the whole subtree and drops touching cross-links", () => {
    const out = applyTreeEdits(treeNodes, treeCrossLinks, [{ type: "delete", id: "a" }])
    // a, c, d, e all removed (c/d/e are a's subtree); b survives
    expect(out.nodes.map((n) => n.id).sort()).toEqual(["b"])
    // the d->b cross-link is dropped since d was removed
    expect(out.crossLinks).toEqual([])
  })

  it("delete a leaf only removes that node", () => {
    const out = applyTreeEdits(treeNodes, treeCrossLinks, [{ type: "delete", id: "e" }])
    expect(out.nodes.map((n) => n.id).sort()).toEqual(["a", "b", "c", "d"])
    expect(out.crossLinks).toEqual(treeCrossLinks)
  })

  it("add attaches a child under the given parent with parent.level + 1", () => {
    const out = applyTreeEdits(treeNodes, treeCrossLinks, [
      { type: "add", parentId: "c", label: " Regla de Cramer " },
    ])
    const added = out.nodes.find((n) => n.label === "Regla de Cramer")
    expect(added).toMatchObject({ level: 3, parentId: "c" })
    expect(added?.id).toMatch(/^new-\d+$/)
  })

  it("add with parentId null creates a new level-1 branch", () => {
    const out = applyTreeEdits(treeNodes, treeCrossLinks, [
      { type: "add", parentId: null, label: "Probabilidad" },
    ])
    expect(out.nodes.find((n) => n.label === "Probabilidad")).toMatchObject({
      level: 1,
      parentId: null,
    })
  })

  it("add under a missing parent is a no-op", () => {
    const out = applyTreeEdits(treeNodes, treeCrossLinks, [
      { type: "add", parentId: "ghost", label: "Fantasma" },
    ])
    expect(out.nodes).toHaveLength(treeNodes.length)
  })

  it("add ignores a blank label", () => {
    const out = applyTreeEdits(treeNodes, treeCrossLinks, [
      { type: "add", parentId: "a", label: "   " },
    ])
    expect(out.nodes).toHaveLength(treeNodes.length)
  })

  it("add refuses to exceed the 6-level cap", () => {
    const deep: TreeNodeDTO[] = [{ id: "x", label: "X", level: 6, parentId: null }]
    const out = applyTreeEdits(deep, [], [{ type: "add", parentId: "x", label: "Y" }])
    expect(out.nodes).toHaveLength(1)
  })

  it("reorder swaps a node with its next sibling (same parentId)", () => {
    const out = applyTreeEdits(treeNodes, treeCrossLinks, [
      { type: "reorder", id: "c", direction: "down" },
    ])
    expect(out.nodes.map((n) => n.id)).toEqual(["a", "b", "d", "c", "e"])
  })

  it("reorder past the edge of the sibling list is a no-op", () => {
    const out = applyTreeEdits(treeNodes, treeCrossLinks, [
      { type: "reorder", id: "a", direction: "up" },
    ])
    expect(out.nodes.map((n) => n.id)).toEqual(treeNodes.map((n) => n.id))
  })

  it("reorder only swaps within the same parent (siblings, not global position)", () => {
    // c and b are adjacent in array order but have different parents (c: a, b: null) —
    // moving c "down" must swap with its actual sibling d, not with b.
    const out = applyTreeEdits(treeNodes, treeCrossLinks, [
      { type: "reorder", id: "c", direction: "down" },
    ])
    expect(out.nodes.find((n) => n.id === "b")?.level).toBe(1) // untouched
  })
})
