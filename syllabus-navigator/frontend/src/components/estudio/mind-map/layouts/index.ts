import type { RichNode } from "../build-tree"
import type { LayoutKind, LayoutResult } from "../types"
import { layoutRadial } from "./radial"
import { layoutTreeHorizontal } from "./tree-horizontal"
import { layoutTreeVertical } from "./tree-vertical"
import { layoutColumnsReport } from "./columns-report"

/** Dispatch by layout key. Unknown/missing layout falls back to radial. */
export function runLayout(kind: LayoutKind | null | undefined, roots: RichNode[]): LayoutResult {
  switch (kind) {
    case "tree_horizontal":
      return layoutTreeHorizontal(roots)
    case "tree_vertical":
      return layoutTreeVertical(roots)
    case "columns_report":
      return layoutColumnsReport(roots)
    case "radial":
    default:
      return layoutRadial(roots)
  }
}
