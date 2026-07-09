"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSyllabus } from "@/context/SyllabusContext"
import { RotateCcw, X } from "lucide-react"
import { MindMapCanvas, type Mindmap, type BranchEdit } from "@/components/estudio/mind-map-canvas"
import { RichMindMapCanvas } from "@/components/estudio/rich-mind-map-canvas"
import { applyBranchEdits, type TreeNodeDTO, type CrossLinkDTO } from "@/lib/ui/graph-edit"
import { updateGraph } from "@/lib/api"
import type { GraphResponseAPI } from "@/types/api"

type GraphNode = GraphResponseAPI["nodes"][number]
type GraphEdge = { source: string; target: string }
type GraphCrossLink = GraphResponseAPI["crossLinks"][number]

type Props = {
  nodes?: GraphNode[]
  edges?: GraphEdge[]
  crossLinks?: GraphCrossLink[]
  /** Chosen presentation layout. Present + non-null → renders via RichMindMapCanvas
   * (3+ level hierarchy). Absent/null → legacy 2-level radial MindMapCanvas. */
  layout?: GraphResponseAPI["layout"]
  graphStatus?: string
  graphError?: string | null
  onReprocess?: () => void
  editable?: boolean
  syllabusId?: string
  onSaved?: (graph: GraphResponseAPI) => void
  /** Title shown in the central node (usually the course name). */
  centerTitle?: string
}

/**
 * Map the raw DAG (topics + prerequisites) into the radial mind-map shape the
 * shared canvas expects: center = course; branches = root topics (no
 * prerequisites); each branch's chips = its direct successor topics.
 */
function toMindmap(nodes: GraphNode[], edges: GraphEdge[], center: string): Mindmap {
  if (nodes.length === 0) return { center, branches: [] }

  const inDeg: Record<string, number> = {}
  const children: Record<string, string[]> = {}
  const labelOf: Record<string, string> = {}
  nodes.forEach((n) => {
    inDeg[n.id] = 0
    children[n.id] = []
    labelOf[n.id] = n.label
  })
  edges.forEach((e) => {
    if (children[e.source]) children[e.source].push(e.target)
    if (inDeg[e.target] !== undefined) inDeg[e.target]++
  })

  let roots = nodes.filter((n) => inDeg[n.id] === 0)
  if (roots.length === 0) roots = nodes // fully-cyclic / no edges fallback

  return {
    center,
    branches: roots.map((r) => ({
      id: r.id,
      label: r.label,
      items: (children[r.id] ?? []).map((cid) => labelOf[cid]).filter(Boolean),
    })),
  }
}

/**
 * Adapter around the shared {@link MindMapCanvas}. Knowledge/chat/mapa feed raw
 * graph data; this turns it into the radial mind-map and owns the short
 * "processing" gate so the canvas never flashes empty while data settles.
 */
export default function GraphCanvas({
  nodes: propNodes,
  edges: propEdges,
  crossLinks: propCrossLinks,
  layout,
  graphStatus,
  graphError,
  onReprocess,
  editable = false,
  syllabusId,
  onSaved,
  centerTitle,
}: Props) {
  const { queryTopicInChat } = useSyllabus()

  const nodes = useMemo(() => propNodes ?? [], [propNodes])
  const edges = useMemo(() => propEdges ?? [], [propEdges])
  const crossLinks = useMemo(() => propCrossLinks ?? [], [propCrossLinks])

  const center = centerTitle?.trim() || nodes[0]?.label || "Mapa mental"
  const mindmap = useMemo(() => toMindmap(nodes, edges, center), [nodes, edges, center])

  // Stable "processing" gate (~1.9s) on mount / course change — fixes the
  // empty-flash bug. Also reflects the backend's in-flight graph status.
  const [selfLoading, setSelfLoading] = useState(true)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const runLoad = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    setSelfLoading(true)
    timer.current = setTimeout(() => setSelfLoading(false), 1900)
  }, [])

  useEffect(() => {
    runLoad()
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [syllabusId, runLoad])

  const loading = selfLoading || graphStatus === "processing" || graphStatus === "pending"

  // Structural branch edits → PATCH the full replacement graph. The server
  // re-keys node ids (external_id → fresh UUIDs), so the caller must consume
  // the returned graph via onSaved. Thrown errors (e.g. 400 cycle) surface in
  // the drawer.
  const saveBranches = useCallback(
    async (branches: BranchEdit[]) => {
      if (!syllabusId) return
      const saved = await updateGraph(syllabusId, applyBranchEdits(nodes, edges, branches))
      onSaved?.(saved)
    },
    [syllabusId, nodes, edges, onSaved],
  )

  // Recursion-aware tree edits (rename / cascade-delete / add-child / sibling
  // reorder at any depth) → same PATCH endpoint. The tree editor never touches
  // the prerequisite DAG, so `edges` passes through unchanged.
  const saveTree = useCallback(
    async (treeNodes: TreeNodeDTO[], treeCrossLinks: CrossLinkDTO[]) => {
      if (!syllabusId) return
      const saved = await updateGraph(syllabusId, {
        nodes: treeNodes.map((n) => ({
          id: n.id,
          label: n.label,
          weight_percent: n.weight_percent,
          level: n.level,
          parentId: n.parentId,
          detail: n.detail,
        })),
        edges,
        crossLinks: treeCrossLinks,
      })
      onSaved?.(saved)
    },
    [syllabusId, edges, onSaved],
  )

  // Failed graph generation — offer a retry.
  if (graphStatus === "failed") {
    return (
      <div className="relative flex h-[560px] w-full flex-col items-center justify-center overflow-hidden rounded-[20px] border border-destructive/30 bg-[#0a0709] p-8">
        <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full border border-destructive/30 bg-destructive/10">
          <X className="h-8 w-8 text-destructive" />
        </div>
        <h3 className="mb-2 text-lg font-bold uppercase tracking-wide text-destructive">
          No se pudo generar el mapa
        </h3>
        <p className="mb-4 max-w-md text-center text-sm leading-relaxed text-muted-foreground">
          Ocurrió un problema al generar el mapa mental. Suele deberse a límites de uso o a un
          formato inesperado del documento del curso.
        </p>
        {graphError && (
          <div className="mb-6 w-full max-w-lg rounded-xl border border-destructive/30 bg-destructive/10 p-3">
            <p className="line-clamp-3 break-all text-center font-mono text-xs text-destructive">
              {graphError}
            </p>
          </div>
        )}
        {onReprocess && (
          <button
            onClick={onReprocess}
            className="inline-flex items-center gap-2 rounded-full bg-accent px-6 py-2 text-xs font-semibold text-accent-foreground transition hover:brightness-110"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reintentar generación
          </button>
        )}
      </div>
    )
  }

  // `layout` present → the graph was generated (or last saved) by the
  // hierarchical pipeline: render the 3+ level canvas. `layout` null → legacy
  // graph, pre-rewrite or never reprocessed since — keep the old radial view.
  if (layout) {
    return (
      <RichMindMapCanvas
        nodes={nodes}
        crossLinks={crossLinks}
        layout={layout}
        centerTitle={center}
        loading={loading}
        onTopicDouble={(label) => queryTopicInChat(label)}
        onSaveTree={editable && syllabusId ? saveTree : undefined}
        onRegenerate={
          editable && onReprocess
            ? () => {
                runLoad()
                onReprocess()
              }
            : undefined
        }
      />
    )
  }

  return (
    <MindMapCanvas
      mindmap={mindmap}
      courseName={center}
      loading={loading}
      onTopicDouble={(label) => queryTopicInChat(label)}
      onRegenerate={
        editable && onReprocess
          ? () => {
              runLoad()
              onReprocess()
            }
          : undefined
      }
      onSaveBranches={editable && syllabusId ? saveBranches : undefined}
    />
  )
}
