"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSyllabus } from "@/context/SyllabusContext"
import { RotateCcw, X } from "lucide-react"
import { RichMindMapCanvas } from "@/components/estudio/rich-mind-map-canvas"
import type { TreeNodeDTO, CrossLinkDTO } from "@/lib/ui/graph-edit"
import { updateGraph, updateCourseGraph } from "@/lib/api"
import type { GraphResponseAPI, CourseGraphResponseAPI } from "@/types/api"

type GraphNode = GraphResponseAPI["nodes"][number]
type GraphEdge = { source: string; target: string }
type GraphCrossLink = GraphResponseAPI["crossLinks"][number]

type Props = {
  nodes?: GraphNode[]
  edges?: GraphEdge[]
  crossLinks?: GraphCrossLink[]
  /** Chosen presentation layout. Null (legacy graph, never reprocessed) falls back to radial. */
  layout?: GraphResponseAPI["layout"]
  graphStatus?: string
  graphError?: string | null
  onReprocess?: () => void
  editable?: boolean
  syllabusId?: string
  /** Course-map mode: edits PATCH /graph/course/[courseId] instead of the per-doc route. */
  courseId?: string
  /** Course documents for the AI drawer's multi-select (course-map mode). */
  courseFiles?: { id: string; name: string }[]
  /** Docs that fed the current course map (persisted multi-select state). */
  sourceDocIds?: string[]
  /** AI regeneration with params — turns the drawer into "Regenerar con IA". */
  onRegenerateAI?: (payload: {
    fileIds: string[]
    focusTopics: string[]
    instructions: string
  }) => void
  onSaved?: (graph: GraphResponseAPI | CourseGraphResponseAPI) => void
  /** Title shown in the central node (usually the course name). */
  centerTitle?: string
}

/**
 * Adapter around {@link RichMindMapCanvas}. Knowledge/chat/mapa feed raw graph
 * data (topics as a level/parent tree + prerequisite edges + cross-links); this
 * wires editing/reprocess and owns the short "processing" gate so the canvas
 * never flashes empty while data settles. Legacy graphs (no `layout` yet)
 * render as radial — `buildTree` treats their flat nodes as level-1 roots.
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
  courseId,
  courseFiles,
  sourceDocIds,
  onRegenerateAI,
  onSaved,
  centerTitle,
}: Props) {
  const { queryTopicInChat } = useSyllabus()

  const nodes = useMemo(() => propNodes ?? [], [propNodes])
  const edges = useMemo(() => propEdges ?? [], [propEdges])
  const crossLinks = useMemo(() => propCrossLinks ?? [], [propCrossLinks])

  const center = centerTitle?.trim() || nodes[0]?.label || "Mapa mental"

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
  }, [syllabusId, courseId, runLoad])

  const loading = selfLoading || graphStatus === "processing" || graphStatus === "pending"

  // Recursion-aware tree edits (rename / cascade-delete / add-child / sibling
  // reorder at any depth) → PATCH the full replacement graph. The server re-keys
  // node ids (external_id → fresh UUIDs), so the caller must consume the returned
  // graph via onSaved. The tree editor never touches the prerequisite DAG, so
  // `edges` passes through unchanged. Thrown errors surface in the drawer.
  const saveTree = useCallback(
    async (treeNodes: TreeNodeDTO[], treeCrossLinks: CrossLinkDTO[]) => {
      if (!syllabusId && !courseId) return
      const payload = {
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
      }
      const saved = courseId
        ? await updateCourseGraph(courseId, payload)
        : await updateGraph(syllabusId!, payload)
      onSaved?.(saved)
    },
    [syllabusId, courseId, edges, onSaved],
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
    <RichMindMapCanvas
      nodes={nodes}
      crossLinks={crossLinks}
      layout={layout ?? "radial"}
      centerTitle={center}
      loading={loading}
      onTopicDouble={(label) => queryTopicInChat(label)}
      onSaveTree={editable && (syllabusId || courseId) ? saveTree : undefined}
      onRegenerate={
        editable && onReprocess
          ? () => {
              runLoad()
              onReprocess()
            }
          : undefined
      }
      courseFiles={courseFiles}
      sourceDocIds={sourceDocIds}
      onRegenerateAI={
        editable && onRegenerateAI
          ? (payload) => {
              runLoad()
              onRegenerateAI(payload)
            }
          : undefined
      }
    />
  )
}
