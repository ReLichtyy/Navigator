import type { RichNode } from "../build-tree"
import { maxDepth } from "../build-tree"
import type { LayoutResult } from "../types"

const BAND_X = 180
const ROW_H = 48

/**
 * Outline-style layout: level-1 branches stack top-to-bottom in the order the
 * LLM gave them (chronological/logical), each occupying its own row; children
 * cascade to subsequent rows, indented one BAND_X to the right. For
 * "sequential or temporal content" (rule 3) — a video, podcast, step-by-step
 * process, timeline.
 */
export function layoutTreeVertical(roots: RichNode[]): LayoutResult {
  const positions = new Map<string, { x: number; y: number }>()
  let rowCursor = 0

  function place(n: RichNode, level: number): void {
    const x = (level - 1) * BAND_X
    const y = rowCursor * ROW_H
    rowCursor += 1
    positions.set(n.id, { x, y })
    n.children.forEach((c) => place(c, level + 1))
  }

  roots.forEach((r) => place(r, 1))

  const maxLevel = roots.reduce((m, r) => Math.max(m, maxDepth(r)), 1)
  const width = maxLevel * BAND_X + 300
  const height = rowCursor * ROW_H + 140

  const shifted = new Map<string, { x: number; y: number }>()
  for (const [id, p] of positions) shifted.set(id, { x: p.x + 150, y: p.y + 70 })

  return { width, height, positions: shifted, center: { x: width / 2, y: 30 } }
}
