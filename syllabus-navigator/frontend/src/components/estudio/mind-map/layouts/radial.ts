import type { RichNode } from "../build-tree"
import type { LayoutResult } from "../types"

const R1 = 150 // radius of level-1 ring
const R_BAND = 130 // radius added per extra level

/**
 * True recursive angular subdivision (sunburst): level-1 branches split a full
 * circle proportional to their subtree's leaf count; each node's angular span
 * is then subdivided the same way among its own children. Radius grows per
 * level. For "3-7 independent, parallel categories" (rule 3) — no left/right
 * bias, no strong hierarchy implied by position.
 */
export function layoutRadial(roots: RichNode[]): LayoutResult {
  const width = 900
  const height = 900
  const cx = width / 2
  const cy = height / 2
  const positions = new Map<string, { x: number; y: number }>()

  const total = roots.reduce((s, r) => s + Math.max(r.leafCount, 1), 0) || 1

  function place(n: RichNode, a0: number, a1: number, level: number) {
    const mid = (a0 + a1) / 2
    const r = R1 + (level - 1) * R_BAND
    positions.set(n.id, { x: cx + r * Math.cos(mid), y: cy + r * Math.sin(mid) })
    if (n.children.length === 0) return
    const childTotal = n.children.reduce((s, c) => s + Math.max(c.leafCount, 1), 0) || 1
    let cursor = a0
    for (const child of n.children) {
      const span = ((a1 - a0) * Math.max(child.leafCount, 1)) / childTotal
      place(child, cursor, cursor + span, level + 1)
      cursor += span
    }
  }

  let angle = -Math.PI / 2 // start at 12 o'clock
  for (const root of roots) {
    const span = (2 * Math.PI * Math.max(root.leafCount, 1)) / total
    place(root, angle, angle + span, 1)
    angle += span
  }

  return { width, height, positions, center: { x: cx, y: cy } }
}
