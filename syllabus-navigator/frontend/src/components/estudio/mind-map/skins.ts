/**
 * mind-map/skins.ts — the "Lienzo" panel data (design Navigator v3).
 *
 * Three view-only, non-persisted knobs the student can flip from the canvas:
 *  - SKELETONS   → which layout algorithm arranges the map ("Esqueleto").
 *  - BRANCH_PALETTES → recolor the branches ("Color del lienzo").
 *  - BG_PALETTES → the canvas backdrop + dot-grid ("Fondo del lienzo").
 *
 * None of this touches the saved graph; it's pure presentation, reset on doc
 * change (see RichMindMapCanvas).
 */

import { Network, GitBranch, ListTree, Columns3, type LucideIcon } from "lucide-react"
import type { LayoutKind } from "./types"

export interface Skeleton {
  layout: LayoutKind
  name: string
  kind: string
  icon: LucideIcon
}

export const SKELETONS: Skeleton[] = [
  { layout: "radial", name: "Radial", kind: "Concéntrico", icon: Network },
  { layout: "tree_horizontal", name: "Árbol horizontal", kind: "Jerárquico", icon: GitBranch },
  { layout: "tree_vertical", name: "Árbol vertical", kind: "Jerárquico", icon: ListTree },
  { layout: "columns_report", name: "Columnas", kind: "Informe", icon: Columns3 },
]

export interface BranchPalette {
  name: string
  /** Colors assigned to root branches in order (wraps with modulo). */
  colors: string[]
}

export const BRANCH_PALETTES: BranchPalette[] = [
  { name: "Original", colors: [] }, // empty = keep each node's own generated color
  {
    name: "Esmeralda",
    colors: ["#5BE39A", "#3FBF84", "#7CE0AC", "#2C9A66", "#9FEDC4", "#48C98A"],
  },
  {
    name: "Océano",
    colors: ["#5BC8E3", "#4F8FE0", "#7CD8E0", "#3F6FC9", "#9FD8ED", "#5AA0E3"],
  },
  {
    name: "Atardecer",
    colors: ["#E3A45B", "#E0745F", "#E0C27C", "#C9663F", "#EDC89F", "#E38A5A"],
  },
  {
    name: "Vibrante",
    colors: ["#5BE39A", "#5BC8E3", "#C79FED", "#E0745F", "#E0C27C", "#7C9FED"],
  },
]

export interface BgPalette {
  name: string
  /** Canvas background color. */
  bg: string
  /** Dot-grid color (radial-gradient dot). */
  dot: string
}

export const BG_PALETTES: BgPalette[] = [
  { name: "Carbón", bg: "#080B09", dot: "rgba(255,255,255,0.045)" },
  { name: "Medianoche", bg: "#080B12", dot: "rgba(140,170,255,0.06)" },
  { name: "Pizarra", bg: "#0E0D0B", dot: "rgba(255,235,200,0.05)" },
  { name: "Bosque", bg: "#06110D", dot: "rgba(120,230,180,0.06)" },
]
