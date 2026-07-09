import type { RichNode } from "../build-tree"
import type { LayoutResult } from "../types"

// Column-block layout: each level-1 branch is a header column, level-2 children
// stack as rows underneath. Level-3 "detail" nodes render as a tooltip on their
// row rather than a further column — this layout's own use case (comparison
// tables, "3 temas x 3 puntos") is inherently shallow.
const BLOCK_W = 210
const BLOCK_GAP = 100
const HEADER_H = 46
const ROW_H = 36
const ROW_GAP = 8
const PAD_TOP = 34
const PAD_SIDE = 40
const MAX_ROWS = 10

export function layoutColumnsReport(roots: RichNode[]): LayoutResult {
  const positions = new Map<string, { x: number; y: number }>()
  const n = roots.length || 1

  const rowsOf = new Map<string, RichNode[]>()
  let maxRows = 0
  for (const r of roots) {
    const rows = r.children.slice(0, MAX_ROWS)
    rowsOf.set(r.id, rows)
    maxRows = Math.max(maxRows, rows.length)
  }

  const totalW = n * BLOCK_W + (n - 1) * BLOCK_GAP
  const width = Math.max(900, totalW + PAD_SIDE * 2)
  const height = Math.max(420, PAD_TOP + HEADER_H + Math.max(maxRows, 1) * (ROW_H + ROW_GAP) + 60)
  const startX = (width - totalW) / 2

  roots.forEach((r, i) => {
    const bx = startX + i * (BLOCK_W + BLOCK_GAP)
    positions.set(r.id, { x: bx + BLOCK_W / 2, y: PAD_TOP + HEADER_H / 2 })
    const rows = rowsOf.get(r.id) ?? []
    rows.forEach((row, j) => {
      positions.set(row.id, {
        x: bx + BLOCK_W / 2,
        y: PAD_TOP + HEADER_H + 14 + j * (ROW_H + ROW_GAP) + ROW_H / 2,
      })
    })
  })

  return { width, height, positions }
}
