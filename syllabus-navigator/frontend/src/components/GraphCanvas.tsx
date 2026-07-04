"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSyllabus } from "@/context/SyllabusContext"
import { RotateCcw, X } from "lucide-react"
import { MindMapCanvas, type Mindmap, type BranchEdit } from "@/components/estudio/mind-map-canvas"
import { applyBranchEdits } from "@/lib/ui/graph-edit"
import { updateGraph } from "@/lib/api"

type GraphNode = { id: string; label: string; weight_percent?: number }
type GraphEdge = { source: string; target: string }

type Props = {
  nodes?: GraphNode[]
  edges?: GraphEdge[]
  graphStatus?: string
  graphError?: string | null
  onReprocess?: () => void
  editable?: boolean
  syllabusId?: string
  onSaved?: (graph: { nodes: GraphNode[]; edges: GraphEdge[] }) => void
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
      onSaved?.({ nodes: saved.nodes, edges: saved.edges })
    },
    [syllabusId, nodes, edges, onSaved],
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
