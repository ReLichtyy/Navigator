export type LayoutKind = "radial" | "tree_horizontal" | "tree_vertical" | "columns_report"

/** Box size per level (1-indexed) — shrinks with depth so deep leaves stay legible but compact. */
const LEVEL_SIZES: { w: number; h: number }[] = [
  { w: 210, h: 68 },
  { w: 186, h: 54 },
  { w: 168, h: 46 },
  { w: 156, h: 42 },
  { w: 146, h: 38 },
  { w: 140, h: 36 },
]

export function sizeForLevel(level: number): { w: number; h: number } {
  return LEVEL_SIZES[Math.min(Math.max(level, 1), LEVEL_SIZES.length) - 1]
}

export interface LayoutResult {
  width: number
  height: number
  /** Center point of each positioned node, keyed by node id. */
  positions: Map<string, { x: number; y: number }>
  /**
   * The map's hub point — where the synthetic "Tema central" node sits and from
   * which the level-1 branches radiate. Radial → geometric center; tree_horizontal
   * → the pivot column. The other layouts still return a point (unused; those
   * views are inherently rooted as an outline / columns).
   */
  center: { x: number; y: number }
}
