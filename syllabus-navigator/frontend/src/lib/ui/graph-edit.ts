/**
 * Pure helpers to apply mind-map edits onto the raw knowledge graph, producing
 * the full replacement payload `PATCH /api/graph/[syllabusId]` expects.
 *
 * Two editors live here:
 * - `applyBranchEdits` (below) — the legacy root-only editor (rename / delete
 *   / add / reorder applied only to in-degree-0 topics), still used for graphs
 *   with no `layout` (pre-rewrite, never reprocessed).
 * - `applyTreeEdits` (further down) — the recursion-aware editor for the 3+
 *   level hierarchy (cascade-delete, add-child at any depth, sibling reorder).
 *
 * The radial canvas only exposes root topics (no prerequisites) as editable
 * branches, so `applyBranchEdits`' edits are applied at the root level:
 * non-root nodes and their edges are preserved untouched unless their root is
 * deleted. The order of `edits` IS the branch order: the server inserts
 * topics in payload order and serves them back in the same order, so it
 * round-trips.
 */

export type GraphNodeDTO = { id: string; label: string; weight_percent?: number | null }
export type GraphEdgeDTO = { source: string; target: string }

/** One branch as edited in the drawer: existing (id) or newly added (null). */
export type BranchEdit = { id: string | null; label: string }

/**
 * Ids of the graph's root nodes (in-degree 0). Mirrors the fallback used by
 * the canvas adapter: if nothing has in-degree 0 (cycle / no edges data),
 * every node counts as a root.
 */
export function rootIds(nodes: GraphNodeDTO[], edges: GraphEdgeDTO[]): Set<string> {
  const inDeg = new Map<string, number>(nodes.map((n) => [n.id, 0]))
  for (const e of edges) {
    const d = inDeg.get(e.target)
    if (d !== undefined) inDeg.set(e.target, d + 1)
  }
  const roots = nodes.filter((n) => inDeg.get(n.id) === 0)
  return new Set((roots.length > 0 ? roots : nodes).map((n) => n.id))
}

/**
 * Apply drawer edits to the graph:
 * - an existing branch present in `edits` keeps its node, renamed to the
 *   trimmed label (an emptied label keeps the original);
 * - a root absent from `edits` is deleted along with every edge touching it
 *   (its orphaned children become roots on the next render);
 * - an edit with `id: null` adds a fresh node (unique `new-N` temp id — the
 *   server maps it to `external_id` and assigns a real UUID) with no edges;
 * - branches come out in `edits` order (that order persists — see header),
 *   with the untouched non-root nodes after them in their original order.
 */
export function applyBranchEdits(
  nodes: GraphNodeDTO[],
  edges: GraphEdgeDTO[],
  edits: BranchEdit[],
): { nodes: GraphNodeDTO[]; edges: GraphEdgeDTO[] } {
  const roots = rootIds(nodes, edges)
  const keptById = new Map(edits.filter((e) => e.id !== null).map((e) => [e.id as string, e]))
  const removed = new Set([...roots].filter((id) => !keptById.has(id)))

  const byId = new Map(nodes.map((n) => [n.id, n]))
  const taken = new Set(nodes.filter((n) => !removed.has(n.id)).map((n) => n.id))
  const emitted = new Set<string>()
  const outNodes: GraphNodeDTO[] = []
  let seq = 1

  for (const e of edits) {
    if (e.id !== null) {
      const node = byId.get(e.id)
      if (!node || removed.has(node.id) || emitted.has(node.id)) continue
      emitted.add(node.id)
      const label = e.label.trim()
      outNodes.push(label ? { ...node, label } : { ...node })
    } else {
      const label = e.label.trim()
      if (!label) continue
      let id = `new-${seq++}`
      while (taken.has(id)) id = `new-${seq++}`
      taken.add(id)
      outNodes.push({ id, label })
    }
  }
  for (const n of nodes) {
    if (removed.has(n.id) || emitted.has(n.id)) continue
    outNodes.push({ ...n })
  }

  const outEdges = edges.filter((e) => !removed.has(e.source) && !removed.has(e.target))
  return { nodes: outNodes, edges: outEdges }
}

// ---------------------------------------------------------------------------
// Tree edits (3+ level hierarchy) — the recursion-aware editor. Unlike
// `applyBranchEdits` above (root-only, array-diff style, kept for the legacy
// no-layout graphs), this operates on the whole tree via a sequence of typed
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
 *   editor's "order round-trips" behavior.
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
