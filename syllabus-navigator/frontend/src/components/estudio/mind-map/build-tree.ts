import type { GraphResponseAPI } from "@/types/api"

export interface RichNode {
  id: string
  label: string
  level: number
  parentId: string | null
  weightPercent: number | null
  detail: string | null
  color: string | null
  children: RichNode[]
  /** Leaf count under this node (itself counts as 1 if it has no children) — drives
   * proportional space allocation (radial angle, tree row count) per layout. */
  leafCount: number
}

/**
 * Flat API nodes (level + parent_id) → a real nested tree. Replaces the old
 * `GraphCanvas#toMindmap`, which only ever surfaced roots + their direct
 * children as flat text — everything at depth >= 2 was silently dropped.
 */
export function buildTree(nodes: GraphResponseAPI["nodes"]): RichNode[] {
  const byId = new Map<string, RichNode>()
  for (const n of nodes) {
    byId.set(n.id, {
      id: n.id,
      label: n.label,
      level: n.level,
      parentId: n.parent_id,
      weightPercent: n.weight_percent || null,
      detail: n.detail,
      color: n.color,
      children: [],
      leafCount: 0,
    })
  }

  const roots: RichNode[] = []
  for (const n of byId.values()) {
    const parent = n.parentId ? byId.get(n.parentId) : undefined
    if (parent) parent.children.push(n)
    else roots.push(n)
  }

  function computeLeafCount(n: RichNode): number {
    if (n.children.length === 0) {
      n.leafCount = 1
      return 1
    }
    n.leafCount = n.children.reduce((sum, c) => sum + computeLeafCount(c), 0)
    return n.leafCount
  }
  roots.forEach(computeLeafCount)

  return roots
}

/** Pre-order flatten (root, then its children, depth-first) — for rendering all nodes/edges. */
export function flattenTree(roots: RichNode[]): RichNode[] {
  const out: RichNode[] = []
  const walk = (n: RichNode) => {
    out.push(n)
    n.children.forEach(walk)
  }
  roots.forEach(walk)
  return out
}

export function maxDepth(n: RichNode, level = 1): number {
  if (n.children.length === 0) return level
  return Math.max(...n.children.map((c) => maxDepth(c, level + 1)))
}
