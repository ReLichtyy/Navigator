/**
 * Pure helpers to apply branch-level mind-map edits (rename / delete / add)
 * onto the raw knowledge graph (topics + prerequisite edges), producing the
 * full replacement payload `PATCH /api/graph/[syllabusId]` expects.
 *
 * The radial canvas only exposes root topics (no prerequisites) as editable
 * branches, so edits are applied at the root level: non-root nodes and their
 * edges are preserved untouched unless their root is deleted.
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
 *   server maps it to `external_id` and assigns a real UUID) with no edges.
 */
export function applyBranchEdits(
  nodes: GraphNodeDTO[],
  edges: GraphEdgeDTO[],
  edits: BranchEdit[],
): { nodes: GraphNodeDTO[]; edges: GraphEdgeDTO[] } {
  const roots = rootIds(nodes, edges)
  const keptById = new Map(edits.filter((e) => e.id !== null).map((e) => [e.id as string, e]))
  const removed = new Set([...roots].filter((id) => !keptById.has(id)))

  const outNodes: GraphNodeDTO[] = nodes
    .filter((n) => !removed.has(n.id))
    .map((n) => {
      const edit = keptById.get(n.id)
      const label = edit?.label.trim()
      return label ? { ...n, label } : { ...n }
    })

  const taken = new Set(outNodes.map((n) => n.id))
  let seq = 1
  for (const e of edits) {
    if (e.id !== null) continue
    const label = e.label.trim()
    if (!label) continue
    let id = `new-${seq++}`
    while (taken.has(id)) id = `new-${seq++}`
    taken.add(id)
    outNodes.push({ id, label })
  }

  const outEdges = edges.filter((e) => !removed.has(e.source) && !removed.has(e.target))
  return { nodes: outNodes, edges: outEdges }
}
