import { describe, it, expect } from "vitest"
import {
  applyTreeEdits,
  type TreeNodeDTO,
  type CrossLinkDTO,
  type TreeEdit,
} from "@/lib/ui/graph-edit"

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

  it("note sets a node's detail (trimmed) and blank clears it to null", () => {
    const set = applyTreeEdits(treeNodes, treeCrossLinks, [
      { type: "note", id: "c", detail: "  Operaciones con matrices  " },
    ])
    expect(set.nodes.find((n) => n.id === "c")?.detail).toBe("Operaciones con matrices")
    const cleared = applyTreeEdits(set.nodes, treeCrossLinks, [
      { type: "note", id: "e", detail: "   " },
    ])
    expect(cleared.nodes.find((n) => n.id === "e")?.detail).toBeNull()
  })

  it("link adds a cross-link between two existing nodes", () => {
    const out = applyTreeEdits(treeNodes, treeCrossLinks, [
      { type: "link", source: "c", target: "b", label: "se relaciona" },
    ])
    expect(out.crossLinks).toContainEqual({ source: "c", target: "b", label: "se relaciona" })
    expect(out.crossLinks).toHaveLength(2)
  })

  it("link skips self-links, missing endpoints, and duplicate pairs", () => {
    const out = applyTreeEdits(treeNodes, treeCrossLinks, [
      { type: "link", source: "c", target: "c", label: "x" },
      { type: "link", source: "c", target: "zz", label: "x" },
      { type: "link", source: "d", target: "b", label: "duplicada" }, // already linked
    ])
    expect(out.crossLinks).toEqual(treeCrossLinks)
  })
})
