/**
 * Pure helpers to apply mind-map edits onto the raw knowledge graph, producing
 * the full replacement payload `PATCH /api/graph/[syllabusId]` expects.
 *
 * `applyTreeEdits` is the recursion-aware editor for the 3+ level hierarchy
 * (rename, cascade-delete, add-child at any depth, sibling reorder).
 */

// ---------------------------------------------------------------------------
// Tree edits (3+ level hierarchy) — the recursion-aware editor. Operates on the
// whole tree via a sequence of typed
// operations: rename, cascade-delete (a node + its whole subtree), add-child
// (under any existing node), and sibling-scoped reorder.
// ---------------------------------------------------------------------------

export type TreeNodeDTO = {
  id: string
  label: string
  weight_percent?: number | null
  level: number
  parentId: string | null
  detail?: string | null
}

export type CrossLinkDTO = { source: string; target: string; label: string }

export type TreeEdit =
  | { type: "rename"; id: string; label: string }
  | { type: "delete"; id: string }
  | { type: "add"; parentId: string | null; label: string }
  | { type: "reorder"; id: string; direction: "up" | "down" }
  // Canvas toolbar edits:
  | { type: "note"; id: string; detail: string | null }
  | { type: "link"; source: string; target: string; label: string }

const MAX_TREE_LEVEL = 6

/** All descendant ids of `id` (not including itself). */
function descendantsOf(id: string, nodes: TreeNodeDTO[]): Set<string> {
  const childrenOf = new Map<string, string[]>()
  for (const n of nodes) {
    if (n.parentId === null) continue
    const list = childrenOf.get(n.parentId) ?? []
    list.push(n.id)
    childrenOf.set(n.parentId, list)
  }
  const out = new Set<string>()
  const queue = [...(childrenOf.get(id) ?? [])]
  while (queue.length > 0) {
    const next = queue.shift() as string
    if (out.has(next)) continue
    out.add(next)
    queue.push(...(childrenOf.get(next) ?? []))
  }
  return out
}

/**
 * Apply a sequence of tree edits onto the graph, producing the full
 * replacement payload `PATCH /api/graph/[syllabusId]` expects:
 * - `rename` relabels a node (blank label is a no-op, keeps the original);
 * - `delete` removes a node AND its entire subtree, plus any cross-links
 *   touching a removed node (server-side `topic_dependencies`/`topic_cross_links`
 *   cascade on the same FK, this mirrors that client-side before the PATCH);
 * - `add` attaches a fresh node (unique `new-N` temp id) as a child of
 *   `parentId` (`null` = new level-1 branch); a dangling/missing parent, a
 *   blank label, or exceeding the 6-level cap silently skips the edit;
 * - `reorder` swaps a node with its adjacent sibling (same `parentId`) —
 *   array order IS the persisted `sort_order`, same convention as the root
 *   editor's "order round-trips" behavior;
 * - `note` sets/clears a node's `detail` (hover blurb, ≤140 chars enforced
 *   server-side; trimmed, blank → null);
 * - `link` adds a cross-link between two EXISTING distinct nodes (blank label,
 *   missing endpoint, self-link, or an already-linked pair silently skips).
 */
export function applyTreeEdits(
  nodes: TreeNodeDTO[],
  crossLinks: CrossLinkDTO[],
  edits: TreeEdit[],
): { nodes: TreeNodeDTO[]; crossLinks: CrossLinkDTO[] } {
  let working = nodes.map((n) => ({ ...n }))
  let links = crossLinks.map((c) => ({ ...c }))
  let seq = 1

  for (const edit of edits) {
    if (edit.type === "rename") {
      const label = edit.label.trim()
      if (!label) continue
      working = working.map((n) => (n.id === edit.id ? { ...n, label } : n))
    } else if (edit.type === "delete") {
      const doomed = new Set([edit.id, ...descendantsOf(edit.id, working)])
      working = working.filter((n) => !doomed.has(n.id))
      links = links.filter((l) => !doomed.has(l.source) && !doomed.has(l.target))
    } else if (edit.type === "add") {
      const label = edit.label.trim()
      if (!label) continue
      const parent = edit.parentId ? working.find((n) => n.id === edit.parentId) : null
      if (edit.parentId && !parent) continue
      if (parent && parent.level >= MAX_TREE_LEVEL) continue
      const taken = new Set(working.map((n) => n.id))
      let id = `new-${seq++}`
      while (taken.has(id)) id = `new-${seq++}`
      working.push({
        id,
        label,
        level: parent ? parent.level + 1 : 1,
        parentId: parent ? parent.id : null,
      })
    } else if (edit.type === "note") {
      const detail = edit.detail?.trim() || null
      working = working.map((n) => (n.id === edit.id ? { ...n, detail } : n))
    } else if (edit.type === "link") {
      const label = edit.label.trim()
      if (!label || edit.source === edit.target) continue
      const ids = new Set(working.map((n) => n.id))
      if (!ids.has(edit.source) || !ids.has(edit.target)) continue
      if (links.some((l) => l.source === edit.source && l.target === edit.target)) continue
      links.push({ source: edit.source, target: edit.target, label: label.slice(0, 60) })
    } else if (edit.type === "reorder") {
      const node = working.find((n) => n.id === edit.id)
      if (!node) continue
      const siblingIdx = working
        .map((n, i) => ({ n, i }))
        .filter(({ n }) => n.parentId === node.parentId)
      const pos = siblingIdx.findIndex(({ n }) => n.id === node.id)
      const swapPos = edit.direction === "up" ? pos - 1 : pos + 1
      if (swapPos < 0 || swapPos >= siblingIdx.length) continue
      const ai = siblingIdx[pos].i
      const bi = siblingIdx[swapPos].i
      ;[working[ai], working[bi]] = [working[bi], working[ai]]
    }
  }

  return { nodes: working, crossLinks: links }
}
