import type { RichNode } from "../build-tree"
import { maxDepth } from "../build-tree"
import type { LayoutResult } from "../types"

const BAND_X = 190
const ROW_H = 50

/**
 * Simplified tidy tree: level-1 branches split left/right of center (load-
 * balanced by leaf count, not just alternating index), each side's leaves get
 * sequential row slots, internal nodes sit at the mean Y of their children.
 * X grows per level, negated on the left side. For "sections with real
 * sub-sections, depth 3+" (rule 3) — e.g. a syllabus with modules -> topics.
 */
export function layoutTreeHorizontal(roots: RichNode[]): LayoutResult {
  const positions = new Map<string, { x: number; y: number }>()

  const leftRoots: RichNode[] = []
  const rightRoots: RichNode[] = []
  let leftLoad = 0
  let rightLoad = 0
  for (const r of roots) {
    if (leftLoad <= rightLoad) {
      leftRoots.push(r)
      leftLoad += Math.max(r.leafCount, 1)
    } else {
      rightRoots.push(r)
      rightLoad += Math.max(r.leafCount, 1)
    }
  }

  function layoutSide(sideRoots: RichNode[], side: 1 | -1): number {
    let rowCursor = 0
    function place(n: RichNode, level: number): number {
      const x = side * level * BAND_X
      if (n.children.length === 0) {
        const y = rowCursor * ROW_H
        rowCursor += 1
        positions.set(n.id, { x, y })
        return y
      }
      const childYs = n.children.map((c) => place(c, level + 1))
      const y = childYs.reduce((a, b) => a + b, 0) / childYs.length
      positions.set(n.id, { x, y })
      return y
    }
    sideRoots.forEach((r) => place(r, 1))
    return rowCursor * ROW_H
  }

  const leftHeight = layoutSide(leftRoots, -1)
  const rightHeight = layoutSide(rightRoots, 1)
  const maxLevelLeft = leftRoots.reduce((m, r) => Math.max(m, maxDepth(r)), 1)
  const maxLevelRight = rightRoots.reduce((m, r) => Math.max(m, maxDepth(r)), 1)

  const width = (maxLevelLeft + maxLevelRight) * BAND_X + 320
  const height = Math.max(leftHeight, rightHeight, 260) + 140
  const centerX = maxLevelLeft * BAND_X + 160

  const shifted = new Map<string, { x: number; y: number }>()
  for (const [id, p] of positions) shifted.set(id, { x: p.x + centerX, y: p.y + 70 })

  // Hub sits on the pivot column, vertically centered on the branch roots.
  const rootYs = roots.map((r) => shifted.get(r.id)?.y ?? height / 2)
  const centerY = rootYs.length ? rootYs.reduce((a, b) => a + b, 0) / rootYs.length : height / 2

  return { width, height, positions: shifted, center: { x: centerX, y: centerY } }
}
