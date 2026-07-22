"use client"

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import {
  Plus,
  Minus,
  Maximize,
  Pencil,
  X,
  RotateCcw,
  Loader2,
  Trash2,
  ChevronUp,
  ChevronDown,
  ChevronRight,
  Check,
  MousePointer2,
  SquarePlus,
  Link2,
  Undo2,
  Sparkles,
  FileText,
  Layers,
  Send,
  Languages,
  AlignLeft,
  AlignJustify,
  BookText,
} from "lucide-react"
import type { GraphResponseAPI } from "@/types/api"
import {
  buildTree,
  flattenTree,
  pruneCollapsed,
  collapsibleBelow,
  maxDepth,
  type RichNode,
} from "./mind-map/build-tree"
import { runLayout } from "./mind-map/layouts"
import { sizeForLevel } from "./mind-map/types"
import { SKELETONS, BRANCH_PALETTES, BG_PALETTES } from "./mind-map/skins"
import {
  applyTreeEdits,
  type TreeNodeDTO,
  type CrossLinkDTO,
  type TreeEdit,
} from "@/lib/ui/graph-edit"

// rgba() from a #rrggbb hex + alpha.
function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

const FALLBACK_COLOR = "#5BE39A"

/** Refine actions fired by the question-bar quick chips. */
type AskRefine = "concise" | "detail" | "translate" | "regenerate"

type Props = {
  nodes: GraphResponseAPI["nodes"]
  crossLinks: GraphResponseAPI["crossLinks"]
  layout: GraphResponseAPI["layout"]
  /** Shown as a small caption pill (no literal center box like the legacy canvas —
   * these layouts don't all have a natural single center point). */
  centerTitle?: string
  loading?: boolean
  onTopicDouble?: (label: string) => void
  /** Structural tree editing. Resolve on saved; reject with an Error to show its message. */
  onSaveTree?: (nodes: TreeNodeDTO[], crossLinks: CrossLinkDTO[]) => Promise<void>
  /** Regenerate the whole map from the document from scratch (no AI params — see plan §5). */
  onRegenerate?: () => void
  /** Course documents for the AI drawer's file multi-select (course maps only). */
  courseFiles?: { id: string; name: string }[]
  /** Docs that fed the current map — initial state of the multi-select. */
  sourceDocIds?: string[]
  /**
   * AI regeneration with params (course maps). When present, the "Editar mapa"
   * drawer becomes the design's "Regenerar con IA" panel (files + focus topics
   * + instructions) and takes precedence over plain onRegenerate.
   */
  onRegenerateAI?: (payload: {
    fileIds: string[]
    focusTopics: string[]
    instructions: string
  }) => void
  /**
   * Course folders shown in the "Curso del mapa" picker inside the Editar drawer
   * (design v3 moves course selection off the page and into the canvas).
   */
  courses?: { key: string; name: string; color?: string | null; count?: number }[]
  selectedCourseKey?: string | null
  onSelectCourse?: (key: string) => void
  /**
   * Inline "ask about this map" (question bar). Returns the assistant's answer
   * text. `refine` chips transform `previousAnswer` instead of asking anew.
   */
  onAsk?: (args: {
    question?: string
    refine?: AskRefine
    previousAnswer?: string
    lang?: string
  }) => Promise<string>
}

/**
 * Renders the 3+ level hierarchical mind map (tree + prerequisite-independent
 * cross-links) across the 4 layouts the generator can choose (radial /
 * tree_horizontal / tree_vertical / columns_report). Full-bleed canvas (design
 * Navigator v3): navigate by collapse/expand, click-to-focus, pan/zoom; restyle
 * via the "Lienzo" panel (skeleton layout + branch/background palettes); edit
 * structure via the right toolbar + "Editar mapa" drawer; and ask grounded
 * questions from the bottom question bar. The sole mind-map canvas — used by
 * /mapa, /knowledge preview and the chat panel via {@link GraphCanvas}.
 */
export function RichMindMapCanvas({
  nodes,
  crossLinks,
  layout,
  centerTitle,
  loading = false,
  onTopicDouble,
  onSaveTree,
  onRegenerate,
  courseFiles,
  sourceDocIds,
  onRegenerateAI,
  courses,
  selectedCourseKey,
  onSelectCourse,
  onAsk,
}: Props) {
  const viewportRef = useRef<HTMLDivElement>(null)
  // The canvas fills its parent now (design is full-bleed). Measure the real
  // viewport box so focus-centering, fit-zoom and the minimap stay correct.
  const [viewH, setViewH] = useState(560)
  const [viewW, setViewW] = useState(860)
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const measure = () => {
      setViewH(el.clientHeight || 560)
      setViewW(el.clientWidth || 860)
    }
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    measure()
    return () => ro.disconnect()
  }, [])

  const roots = useMemo(() => buildTree(nodes), [nodes])
  const allFlat = useMemo(() => flattenTree(roots), [roots]) // every node (for focus)
  const treeDepth = useMemo(() => roots.reduce((m, r) => Math.max(m, maxDepth(r)), 1), [roots])

  // Root-branch index of every node (for palette recoloring — each root branch
  // gets one palette slot; descendants inherit it).
  const rootIndexById = useMemo(() => {
    const m = new Map<string, number>()
    roots.forEach((r, i) => {
      const walk = (n: RichNode) => {
        m.set(n.id, i)
        n.children.forEach(walk)
      }
      walk(r)
    })
    return m
  }, [roots])

  // --- navigation state (all local, not persisted) ---
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [focusId, setFocusId] = useState<string | null>(null)
  // View options (now in the Lienzo panel): default expansion depth + toggles.
  const [expandDepth, setExpandDepth] = useState(0) // 0 = show all levels
  const [showCrossLinks, setShowCrossLinks] = useState(true)
  const [showWeights, setShowWeights] = useState(true)

  // Local layout override ("Esqueleto") — view-only, not persisted. null = use
  // the generator's chosen layout.
  const [layoutOverride, setLayoutOverride] = useState<GraphResponseAPI["layout"] | null>(null)
  const activeLayout = layoutOverride ?? layout
  // The synthetic "Tema central" hub anchors the branches — drawn for the two
  // layouts where a single center reads naturally (radial ring / tree pivot).
  // The outline (tree_vertical) and columns views are already rooted visually.
  const showHub = activeLayout === "radial" || activeLayout === "tree_horizontal"

  // "Lienzo" skins (view-only): branch palette + background palette.
  const [lienzoOpen, setLienzoOpen] = useState(false)
  const [branchIdx, setBranchIdx] = useState(0)
  const [bgIdx, setBgIdx] = useState(0)
  const bg = BG_PALETTES[bgIdx] ?? BG_PALETTES[0]
  const branchColors = BRANCH_PALETTES[branchIdx]?.colors ?? []
  // Effective color of a node: palette slot by root branch, else its own color.
  const colorOf = (node: { id: string; color: string | null }): string => {
    if (branchColors.length > 0) {
      const idx = rootIndexById.get(node.id) ?? 0
      return branchColors[idx % branchColors.length]
    }
    return node.color ?? FALLBACK_COLOR
  }

  // Reset navigation + skins when the underlying document changes.
  useEffect(() => {
    setCollapsed(new Set())
    setFocusId(null)
    setExpandDepth(0)
    setLayoutOverride(null)
    setBranchIdx(0)
    setBgIdx(0)
    setAskOpen(false)
    setAskTxt("")
    setAskQ("")
  }, [nodes])

  // Apply a default expansion depth: collapse every node at/below that level.
  const applyDepth = (d: number) => {
    setExpandDepth(d)
    setCollapsed(d <= 0 ? new Set() : collapsibleBelow(roots, d))
    setFocusId(null)
  }

  // Visible tree = the full tree minus collapsed subtrees. Layout runs on it so
  // positions recompute and the map compacts when branches fold.
  const pruned = useMemo(() => pruneCollapsed(roots, collapsed), [roots, collapsed])
  const flat = useMemo(() => flattenTree(pruned), [pruned])
  const result = useMemo(() => runLayout(activeLayout, pruned), [activeLayout, pruned])

  // Ancestor + descendant sets of the focused node — everything else dims.
  const highlight = useMemo(() => {
    if (!focusId) return null
    const set = new Set<string>([focusId])
    const byId = new Map(allFlat.map((n) => [n.id, n]))
    let cur = byId.get(focusId)
    while (cur?.parentId) {
      set.add(cur.parentId)
      cur = byId.get(cur.parentId)
    }
    const descend = (n?: RichNode) => n?.children.forEach((c) => (set.add(c.id), descend(c)))
    descend(byId.get(focusId))
    return set
  }, [focusId, allFlat])

  const fitZoom = Math.min(1, Math.max(0.3, (viewW - 40) / result.width, (viewH - 100) / result.height))
  const [zoom, setZoom] = useState(fitZoom)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [drag, setDrag] = useState<{ x: number; y: number; px: number; py: number } | null>(null)
  const movedRef = useRef(false)

  // Re-fit whenever the world or viewport size changes (doc switch / collapse /
  // panel resize).
  useEffect(() => {
    setZoom(fitZoom)
    setPan({ x: 0, y: 0 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result.width, result.height, viewH, viewW])

  const zoomBy = (f: number) => setZoom((z) => Math.min(2.2, Math.max(0.25, +(z * f).toFixed(2))))
  const zoomReset = () => {
    setFocusId(null)
    setZoom(fitZoom)
    setPan({ x: 0, y: 0 })
  }

  // Center + zoom onto a node (click-to-focus).
  const centerOn = (id: string) => {
    const p = result.positions.get(id)
    if (!p) return
    const z = 1.15
    setZoom(z)
    setPan({ x: viewW / 2 - p.x * z, y: viewH / 2 - p.y * z })
  }
  const focusNode = (id: string) => {
    setFocusId(id)
    centerOn(id)
  }

  const toggleCollapse = (id: string) =>
    setCollapsed((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const panStart = (e: React.MouseEvent) => {
    movedRef.current = false
    setDrag({ x: e.clientX, y: e.clientY, px: pan.x, py: pan.y })
  }
  const panMove = (e: React.MouseEvent) => {
    if (!drag) return
    if (Math.abs(e.clientX - drag.x) > 3 || Math.abs(e.clientY - drag.y) > 3)
      movedRef.current = true
    setPan({ x: drag.px + (e.clientX - drag.x), y: drag.py + (e.clientY - drag.y) })
  }
  const panEnd = () => setDrag(null)
  // Click on empty canvas (not a drag) clears the focus dim + any pending
  // connect pick / inline editor / open menus.
  const onCanvasClick = () => {
    if (movedRef.current) return
    setFocusId(null)
    if (connectFrom) setConnectFrom(null)
    if (inlineEdit) setInlineEdit(null)
    if (lienzoOpen) setLienzoOpen(false)
    if (langOpen) setLangOpen(false)
  }

  const worldStyle: CSSProperties = {
    position: "absolute",
    left: 0,
    top: 0,
    width: result.width,
    height: result.height,
    transformOrigin: "0 0",
    transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})`,
    transition: drag ? "none" : "transform .18s ease",
  }

  // --- structural editor drawer (recursion-aware: any depth) ---
  const [editOpen, setEditOpen] = useState(false)
  const [draftNodes, setDraftNodes] = useState<TreeNodeDTO[]>([])
  const [draftLinks, setDraftLinks] = useState<CrossLinkDTO[]>([])
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState<string | null>(null)
  const [newRootLabel, setNewRootLabel] = useState("")

  const openDrawer = () => {
    setDraftNodes(
      nodes.map((n) => ({
        id: n.id,
        label: n.label,
        weight_percent: n.weight_percent,
        level: n.level,
        parentId: n.parent_id,
        detail: n.detail,
      })),
    )
    setDraftLinks(crossLinks.map((c) => ({ ...c })))
    setSaveErr(null)
    setPendingDeleteId(null)
    setEditOpen(true)
  }

  const applyEdit = (edit: TreeEdit) => {
    const out = applyTreeEdits(draftNodes, draftLinks, [edit])
    setDraftNodes(out.nodes)
    setDraftLinks(out.crossLinks)
  }

  // Rename bypasses applyTreeEdits (which no-ops on a blank label) so the
  // input stays responsive while the user is mid-edit/clearing the field.
  const renameDirect = (id: string, label: string) =>
    setDraftNodes((ns) => ns.map((n) => (n.id === id ? { ...n, label } : n)))

  const countDescendants = (id: string): number => {
    const children = draftNodes.filter((n) => n.parentId === id)
    return children.length + children.reduce((s, c) => s + countDescendants(c.id), 0)
  }

  const requestDelete = (id: string) => {
    if (countDescendants(id) > 0) setPendingDeleteId(id)
    else applyEdit({ type: "delete", id })
  }
  const confirmDelete = () => {
    if (pendingDeleteId) applyEdit({ type: "delete", id: pendingDeleteId })
    setPendingDeleteId(null)
  }

  const addRoot = () => {
    const label = newRootLabel.trim()
    if (!label) return
    applyEdit({ type: "add", parentId: null, label })
    setNewRootLabel("")
  }

  const save = async () => {
    if (!onSaveTree || saving) return
    setSaving(true)
    setSaveErr(null)
    try {
      await onSaveTree(draftNodes, draftLinks)
      setEditOpen(false)
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : "No se pudo guardar el mapa.")
    } finally {
      setSaving(false)
    }
  }

  const draftValid = draftNodes.length > 0 && draftNodes.every((n) => n.label.trim().length > 0)
  const draftRoots = draftNodes.filter((n) => n.parentId === null)

  // --- canvas toolbar (design v3: vertical — select / add / connect / delete) ---
  type Tool = "select" | "add" | "connect" | "delete"
  const [tool, setTool] = useState<Tool>("select")
  const [connectFrom, setConnectFrom] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [toolBusy, setToolBusy] = useState(false)
  const [toolErr, setToolErr] = useState<string | null>(null)
  // Inline node editor (add child / rename) positioned over the node.
  const [inlineEdit, setInlineEdit] = useState<{
    mode: "add" | "rename"
    nodeId: string
    value: string
  } | null>(null)
  // One-level undo: the graph snapshot captured before the last toolbar edit.
  const [undoSnap, setUndoSnap] = useState<{
    nodes: TreeNodeDTO[]
    crossLinks: CrossLinkDTO[]
  } | null>(null)

  // Leaving a tool clears its in-flight picks.
  const pickTool = (t: Tool) => {
    setTool(t)
    setConnectFrom(null)
    setDeleteId(null)
    setInlineEdit(null)
    setToolErr(null)
  }

  // Tool errors auto-dismiss.
  useEffect(() => {
    if (!toolErr) return
    const t = setTimeout(() => setToolErr(null), 4000)
    return () => clearTimeout(t)
  }, [toolErr])

  // The "Deshacer" affordance auto-dismisses so a stale snapshot can't be
  // applied over unrelated later edits.
  useEffect(() => {
    if (!undoSnap) return
    const t = setTimeout(() => setUndoSnap(null), 6000)
    return () => clearTimeout(t)
  }, [undoSnap])

  // One-shot PATCH: current graph + a single toolbar edit → onSaveTree.
  const toDTO = (): TreeNodeDTO[] =>
    nodes.map((n) => ({
      id: n.id,
      label: n.label,
      weight_percent: n.weight_percent,
      level: n.level,
      parentId: n.parent_id,
      detail: n.detail,
    }))
  const quickEdit = async (edit: TreeEdit) => {
    if (!onSaveTree || toolBusy) return
    // Snapshot the pre-edit graph so this single change can be undone.
    const before = { nodes: toDTO(), crossLinks: crossLinks.map((c) => ({ ...c })) }
    setToolBusy(true)
    setToolErr(null)
    try {
      const out = applyTreeEdits(before.nodes, before.crossLinks, [edit])
      await onSaveTree(out.nodes, out.crossLinks)
      setUndoSnap(before)
    } catch (e) {
      setToolErr(e instanceof Error ? e.message : "No se pudo guardar el cambio.")
    } finally {
      setToolBusy(false)
    }
  }

  // Restore the snapshot captured before the last toolbar edit.
  const undoLast = async () => {
    if (!onSaveTree || toolBusy || !undoSnap) return
    const snap = undoSnap
    setUndoSnap(null)
    setToolBusy(true)
    setToolErr(null)
    try {
      await onSaveTree(snap.nodes, snap.crossLinks)
    } catch (e) {
      setToolErr(e instanceof Error ? e.message : "No se pudo deshacer.")
    } finally {
      setToolBusy(false)
    }
  }

  const descendantCount = (id: string): number => {
    const children = nodes.filter((n) => n.parent_id === id)
    return children.length + children.reduce((s, c) => s + descendantCount(c.id), 0)
  }

  // Commit the inline editor (Enter): create the child / rename the node.
  const commitInline = () => {
    if (!inlineEdit) return
    const label = inlineEdit.value.trim()
    const { mode, nodeId } = inlineEdit
    setInlineEdit(null)
    if (!label) return
    if (mode === "add") void quickEdit({ type: "add", parentId: nodeId, label })
    else void quickEdit({ type: "rename", id: nodeId, label })
  }

  // Double-click a node: rename inline on an editable map, else send to chat.
  const onNodeDouble = (id: string, label: string) => {
    if (onSaveTree) {
      setInlineEdit({ mode: "rename", nodeId: id, value: label })
      setDeleteId(null)
    } else {
      onTopicDouble?.(label)
    }
  }

  // Tool-aware node click (toolbar modes bypass the default click-to-focus).
  const onNodeToolClick = (id: string): boolean => {
    if (tool === "select") return false
    if (!onSaveTree) return false
    if (tool === "add") {
      setInlineEdit({ mode: "add", nodeId: id, value: "" })
    } else if (tool === "connect") {
      if (!connectFrom) setConnectFrom(id)
      else if (connectFrom !== id) {
        void quickEdit({ type: "link", source: connectFrom, target: id, label: "se relaciona" })
        setConnectFrom(null)
      }
    } else if (tool === "delete") {
      const rootNodes = nodes.filter((n) => n.parent_id === null)
      const isLastRoot = rootNodes.length === 1 && rootNodes[0].id === id
      if (isLastRoot) setToolErr("No puedes eliminar la única rama del mapa.")
      else setDeleteId(id)
    }
    return true
  }

  // --- AI drawer state (course maps: files + focus topics + instructions) ---
  const [fileSel, setFileSel] = useState<Set<string>>(new Set())
  const [focusSel, setFocusSel] = useState<Set<string>>(new Set())
  const [instructions, setInstructions] = useState("")
  const rootLabels = useMemo(() => roots.map((r) => r.label).slice(0, 10), [roots])
  const recos = useMemo(() => {
    const heaviest = [...roots].sort((a, b) => (b.weightPercent ?? 0) - (a.weightPercent ?? 0))[0]
    const out = [
      heaviest ? `Expande "${heaviest.label}" con más subtemas y ejemplos.` : "",
      "Enfatiza las relaciones entre conceptos de distintas ramas.",
      "Usa lenguaje sencillo, pensado para repasar antes del examen.",
    ]
    return out.filter(Boolean)
  }, [roots])

  const [manualOpen, setManualOpen] = useState(false)
  const openAIDrawer = () => {
    const all = (courseFiles ?? []).map((f) => f.id)
    const initial = (sourceDocIds ?? []).filter((id) => all.includes(id))
    setFileSel(new Set(initial.length > 0 ? initial : all))
    setFocusSel(new Set())
    setInstructions("")
    setManualOpen(false)
    // The collapsible manual editor reuses the structural drafts.
    openDrawer()
  }

  const toggleIn = (set: Set<string>, v: string) => {
    const next = new Set(set)
    if (next.has(v)) next.delete(v)
    else next.add(v)
    return next
  }

  const fireRegenerateAI = () => {
    if (!onRegenerateAI || fileSel.size === 0) return
    setEditOpen(false)
    onRegenerateAI({
      fileIds: [...fileSel],
      focusTopics: [...focusSel],
      instructions: instructions.trim(),
    })
  }

  // --- inline "ask about this map" (question bar) ---
  const [ask, setAsk] = useState("")
  const [askQ, setAskQ] = useState("")
  const [askTxt, setAskTxt] = useState("")
  const [askOpen, setAskOpen] = useState(false)
  const [askBusy, setAskBusy] = useState(false)
  const [askErr, setAskErr] = useState<string | null>(null)
  const [langOpen, setLangOpen] = useState(false)
  const LANGS = ["Inglés", "Portugués", "Francés"]

  const runAsk = async (args: {
    question?: string
    refine?: AskRefine
    previousAnswer?: string
    lang?: string
  }) => {
    if (!onAsk || askBusy) return
    setAskBusy(true)
    setAskErr(null)
    setAskOpen(true)
    setLangOpen(false)
    try {
      const answer = await onAsk(args)
      setAskTxt(answer)
    } catch (e) {
      setAskErr(e instanceof Error ? e.message : "No se pudo responder.")
    } finally {
      setAskBusy(false)
    }
  }
  const sendAsk = () => {
    const q = ask.trim()
    if (!q) return
    setAskQ(q)
    setAsk("")
    void runAsk({ question: q })
  }
  const canRefine = askTxt.trim().length > 0 && !askBusy

  return (
    <div className="h-full">
      <div
        ref={viewportRef}
        onMouseDown={panStart}
        onMouseMove={panMove}
        onMouseUp={panEnd}
        onMouseLeave={panEnd}
        onClick={onCanvasClick}
        className="relative h-full overflow-hidden"
        style={{
          backgroundColor: bg.bg,
          backgroundImage: `radial-gradient(circle,${bg.dot} 1px,transparent 1px)`,
          backgroundSize: "28px 28px",
          cursor: drag ? "grabbing" : "grab",
          userSelect: "none",
        }}
      >
        <div style={worldStyle}>
          <svg
            width={result.width}
            height={result.height}
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              pointerEvents: "none",
              overflow: "visible",
            }}
          >
            {activeLayout !== "columns_report" &&
              flat.map((node) => {
                if (!node.parentId) return null
                const a = result.positions.get(node.parentId)
                const b = result.positions.get(node.id)
                if (!a || !b) return null
                const color = colorOf(node)
                const midX = (a.x + b.x) / 2
                const on = !highlight || (highlight.has(node.id) && highlight.has(node.parentId))
                return (
                  <path
                    key={`e-${node.id}`}
                    d={`M${a.x},${a.y} C${midX},${a.y} ${midX},${b.y} ${b.x},${b.y}`}
                    fill="none"
                    stroke={color}
                    strokeWidth={1.8}
                    strokeOpacity={on ? 0.55 : 0.08}
                    strokeLinecap="round"
                  />
                )
              })}
            {/* hub edges: the central node → each level-1 branch */}
            {showHub &&
              pruned.map((root) => {
                const a = result.center
                const b = result.positions.get(root.id)
                if (!b) return null
                const color = colorOf(root)
                const midX = (a.x + b.x) / 2
                const on = !highlight || highlight.has(root.id)
                return (
                  <path
                    key={`hub-${root.id}`}
                    d={`M${a.x},${a.y} C${midX},${a.y} ${midX},${b.y} ${b.x},${b.y}`}
                    fill="none"
                    stroke={color}
                    strokeWidth={2}
                    strokeOpacity={on ? 0.5 : 0.08}
                    strokeLinecap="round"
                  />
                )
              })}
            {showCrossLinks &&
              crossLinks.map((c, i) => {
                const a = result.positions.get(c.source)
                const b = result.positions.get(c.target)
                if (!a || !b) return null
                const midX = (a.x + b.x) / 2
                const on = !highlight || (highlight.has(c.source) && highlight.has(c.target))
                return (
                  <path
                    key={`x-${i}`}
                    d={`M${a.x},${a.y} C${midX},${a.y} ${midX},${b.y} ${b.x},${b.y}`}
                    fill="none"
                    stroke="rgba(159,237,196,0.8)"
                    strokeWidth={1.6}
                    strokeDasharray="5 5"
                    strokeOpacity={on ? 0.75 : 0.08}
                    strokeLinecap="round"
                  />
                )
              })}
          </svg>

          {flat.map((node) => {
            const pos = result.positions.get(node.id)
            if (!pos) return null
            const size = sizeForLevel(node.level)
            const color = colorOf(node)
            const title =
              node.detail ??
              (node.children[0] ? (node.children[0].detail ?? node.children[0].label) : undefined)
            const dimmed = !!highlight && !highlight.has(node.id)
            const isFocus = focusId === node.id
            const isConnectSrc = connectFrom === node.id
            const foldable = node.children.length > 0 || node.collapsedCount > 0
            const isCollapsed = node.collapsedCount > 0
            return (
              <div
                key={node.id}
                onClick={(e) => {
                  e.stopPropagation()
                  if (movedRef.current) return
                  if (!onNodeToolClick(node.id)) focusNode(node.id)
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation()
                  onNodeDouble(node.id, node.label)
                }}
                title={title}
                style={{
                  position: "absolute",
                  left: pos.x - size.w / 2,
                  top: pos.y - size.h / 2,
                  width: size.w,
                  minHeight: size.h,
                  borderRadius: 14,
                  padding: "10px 12px",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                  cursor: "pointer",
                  opacity: dimmed ? 0.28 : 1,
                  border: `1px solid ${isConnectSrc ? "#5BE39A" : isFocus ? hexA(color, 0.95) : hexA(color, 0.5)}`,
                  background: `linear-gradient(160deg,${hexA(color, isFocus ? 0.22 : 0.13)},rgba(16,21,18,0.96))`,
                  boxShadow: isConnectSrc
                    ? "0 0 0 2px rgba(91,227,154,0.6), 0 10px 24px rgba(0,0,0,0.4)"
                    : isFocus
                      ? `0 0 26px ${hexA(color, 0.28)}`
                      : "0 10px 24px rgba(0,0,0,0.4)",
                  transition: "opacity .18s, box-shadow .18s, border-color .18s",
                }}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="flex-none"
                    style={{ width: 8, height: 8, borderRadius: 3, background: color }}
                  />
                  <span className="flex-1 text-[12.5px] font-bold leading-snug text-[#EEF3F0]">
                    {node.label}
                  </span>
                  {foldable && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleCollapse(node.id)
                      }}
                      title={isCollapsed ? "Expandir" : "Colapsar"}
                      className="flex h-5 flex-none items-center gap-0.5 rounded-md px-1 text-[9.5px] font-bold"
                      style={{ background: hexA(color, 0.16), color: hexA(color, 0.95) }}
                    >
                      {isCollapsed ? (
                        <>
                          <ChevronRight className="h-3 w-3" />
                          {node.collapsedCount}
                        </>
                      ) : (
                        <ChevronDown className="h-3 w-3" />
                      )}
                    </button>
                  )}
                </div>
                {showWeights && node.level === 1 && node.weightPercent != null && (
                  <span
                    className="mt-1.5 self-start rounded-md px-1.5 font-mono text-[9.5px] font-semibold"
                    style={{ background: hexA(color, 0.16), color: hexA(color, 0.95) }}
                  >
                    {Math.round(node.weightPercent)}%
                  </span>
                )}
              </div>
            )
          })}

          {/* central node ("Tema central") — the hub the branches radiate from */}
          {showHub && roots.length > 0 && (
            <div
              onClick={(e) => {
                e.stopPropagation()
                zoomReset()
              }}
              className="flex flex-col items-center gap-1 text-center"
              style={{
                position: "absolute",
                left: result.center.x - 100,
                top: result.center.y - 34,
                width: 200,
                padding: "12px 16px",
                borderRadius: 16,
                background: "linear-gradient(160deg,#15251c,#0e1712)",
                border: "1px solid rgba(63,191,132,0.5)",
                boxShadow: "0 0 34px rgba(63,191,132,0.22), 0 12px 30px rgba(0,0,0,0.5)",
                cursor: "pointer",
              }}
            >
              <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#6FCB9A]">
                Tema central
              </span>
              <span className="text-[15px] font-extrabold leading-tight text-[#F2F6F4]">
                {centerTitle || "Mapa mental"}
              </span>
            </div>
          )}

          {showCrossLinks &&
            crossLinks.map((c, i) => {
              const a = result.positions.get(c.source)
              const b = result.positions.get(c.target)
              if (!a || !b) return null
              const midX = (a.x + b.x) / 2
              const midY = (a.y + b.y) / 2
              const on = !highlight || (highlight.has(c.source) && highlight.has(c.target))
              return (
                <div
                  key={`xl-${i}`}
                  className="pointer-events-none"
                  style={{
                    position: "absolute",
                    left: midX,
                    top: midY,
                    transform: "translate(-50%,-50%)",
                    padding: "2px 7px",
                    borderRadius: 999,
                    fontSize: 9.5,
                    fontWeight: 700,
                    color: "#9FEDC4",
                    background: "rgba(12,16,14,0.9)",
                    border: "1px solid rgba(159,237,196,0.35)",
                    whiteSpace: "nowrap",
                    opacity: on ? 1 : 0.12,
                  }}
                >
                  {c.label}
                </div>
              )
            })}
        </div>

        {/* top-left: title caption */}
        {centerTitle && (
          <div
            className="pointer-events-none absolute left-[18px] top-[18px] rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-[#9AA39E]"
            style={{
              background: "rgba(12,16,14,0.85)",
              border: "1px solid rgba(255,255,255,0.08)",
              backdropFilter: "blur(6px)",
            }}
          >
            {centerTitle}
          </div>
        )}

        {/* top-right: Lienzo (skins) + Editar mapa */}
        <div
          className="absolute right-14 top-4 z-[22] flex items-start gap-2 lg:right-36"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="relative">
            <button
              onClick={() => setLienzoOpen((o) => !o)}
              className="flex items-center gap-1.5 rounded-[11px] px-[13px] py-[9px] text-[12.5px] font-bold text-[#C9D2CD]"
              style={{
                backdropFilter: "blur(6px)",
                border: "1px solid rgba(255,255,255,0.12)",
                background: lienzoOpen ? "rgba(255,255,255,0.08)" : "rgba(12,16,14,0.85)",
              }}
            >
              <Layers className="h-3.5 w-3.5" />
              Lienzo
              <ChevronDown
                className="h-3 w-3"
                style={{ transform: lienzoOpen ? "rotate(180deg)" : undefined }}
              />
            </button>
            {lienzoOpen && (
              <div
                className="absolute right-0 top-[44px] z-[24] w-[268px] overflow-y-auto rounded-2xl p-3.5"
                style={{
                  maxHeight: "min(70vh, 520px)",
                  background: "rgba(14,18,16,0.97)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  boxShadow: "0 14px 36px rgba(0,0,0,0.5)",
                  backdropFilter: "blur(8px)",
                }}
              >
                {/* Esqueleto */}
                <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6FCB9A]">
                  Esqueleto
                </div>
                <div className="mt-0.5 text-[11px] leading-[1.4] text-[#7C8983]">
                  Cada esqueleto reorganiza el mapa con su propia estructura visual.
                </div>
                <div className="mt-2.5 flex flex-col gap-1">
                  {SKELETONS.map((sk) => {
                    const on = activeLayout === sk.layout
                    const Icon = sk.icon
                    return (
                      <button
                        key={sk.layout}
                        onClick={() => setLayoutOverride(sk.layout)}
                        className="flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left"
                        style={{
                          border: `1px solid ${on ? "rgba(63,191,132,0.4)" : "rgba(255,255,255,0.08)"}`,
                          background: on ? "rgba(63,191,132,0.08)" : "transparent",
                        }}
                      >
                        <span
                          className="flex h-7 w-7 flex-none items-center justify-center rounded-lg"
                          style={{ background: "rgba(63,191,132,0.12)" }}
                        >
                          <Icon className="h-3.5 w-3.5 text-[#5BE39A]" />
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col gap-px">
                          <span className="text-[12.5px] font-bold text-[#EEF3F0]">{sk.name}</span>
                          <span className="text-[10.5px] font-semibold text-[#7C8983]">
                            {sk.kind}
                          </span>
                        </span>
                        {on && <Check className="h-[15px] w-[15px] flex-none text-[#5BE39A]" />}
                      </button>
                    )
                  })}
                </div>

                {/* Color del lienzo (ramas) */}
                <div className="mt-3.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6FCB9A]">
                  Color de las ramas
                </div>
                <div className="mt-2 flex flex-col gap-1">
                  {BRANCH_PALETTES.map((pl, i) => {
                    const on = branchIdx === i
                    const swatches = pl.colors.length > 0 ? pl.colors.slice(0, 4) : ["#5BE39A", "#5BC8E3", "#E0C27C", "#E0745F"]
                    return (
                      <button
                        key={pl.name}
                        onClick={() => setBranchIdx(i)}
                        className="flex items-center gap-2.5 rounded-[10px] px-2.5 py-2"
                        style={{
                          border: `1px solid ${on ? "rgba(63,191,132,0.4)" : "rgba(255,255,255,0.08)"}`,
                          background: on ? "rgba(63,191,132,0.08)" : "transparent",
                        }}
                      >
                        <span className="flex flex-none gap-1">
                          {swatches.map((c, j) => (
                            <span
                              key={j}
                              style={{
                                width: 14,
                                height: 14,
                                borderRadius: 5,
                                background: c,
                                opacity: pl.colors.length === 0 ? 0.5 : 1,
                              }}
                            />
                          ))}
                        </span>
                        <span className="flex-1 text-left text-[12px] font-semibold text-[#C9D2CD]">
                          {pl.name}
                        </span>
                        {on && <Check className="h-3.5 w-3.5 flex-none text-[#5BE39A]" />}
                      </button>
                    )
                  })}
                </div>

                {/* Fondo del lienzo */}
                <div className="mt-3.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6FCB9A]">
                  Fondo del lienzo
                </div>
                <div className="mt-2 flex flex-col gap-1">
                  {BG_PALETTES.map((p, i) => {
                    const on = bgIdx === i
                    return (
                      <button
                        key={p.name}
                        onClick={() => setBgIdx(i)}
                        className="flex items-center gap-2.5 rounded-[10px] px-2.5 py-2"
                        style={{
                          border: `1px solid ${on ? "rgba(63,191,132,0.4)" : "rgba(255,255,255,0.08)"}`,
                          background: on ? "rgba(63,191,132,0.08)" : "transparent",
                        }}
                      >
                        <span
                          className="flex-none"
                          style={{
                            width: 26,
                            height: 18,
                            borderRadius: 6,
                            background: p.bg,
                            border: "1px solid rgba(255,255,255,0.12)",
                            backgroundImage: `radial-gradient(circle,${p.dot} 1px,transparent 1px)`,
                            backgroundSize: "6px 6px",
                          }}
                        />
                        <span className="flex-1 text-left text-[12px] font-semibold text-[#C9D2CD]">
                          {p.name}
                        </span>
                        {on && <Check className="h-3.5 w-3.5 flex-none text-[#5BE39A]" />}
                      </button>
                    )
                  })}
                </div>

                {/* Vista */}
                <div className="mt-3.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6FCB9A]">
                  Vista
                </div>
                <div className="mb-1 mt-2 flex gap-1">
                  {[
                    { d: 1, label: "1" },
                    { d: 2, label: "2" },
                    { d: 3, label: "3" },
                    { d: 0, label: "Todo" },
                  ]
                    .filter((o) => o.d === 0 || o.d < treeDepth)
                    .map((o) => {
                      const on = expandDepth === o.d
                      return (
                        <button
                          key={o.d}
                          onClick={() => applyDepth(o.d)}
                          className="flex-1 rounded-md py-1 text-[11px] font-semibold"
                          style={{
                            border: `1px solid ${on ? "rgba(63,191,132,0.45)" : "rgba(255,255,255,0.1)"}`,
                            background: on ? "rgba(63,191,132,0.14)" : "transparent",
                            color: on ? "#9FEDC4" : "#9AA39E",
                          }}
                        >
                          {o.label}
                        </button>
                      )
                    })}
                </div>
                <label className="flex cursor-pointer items-center justify-between py-1 text-[11.5px] font-semibold text-[#C9D2CD]">
                  Conexiones
                  <input
                    type="checkbox"
                    checked={showCrossLinks}
                    onChange={(e) => setShowCrossLinks(e.target.checked)}
                    className="accent-[#5BE39A]"
                  />
                </label>
                <label className="flex cursor-pointer items-center justify-between py-1 text-[11.5px] font-semibold text-[#C9D2CD]">
                  Pesos (%)
                  <input
                    type="checkbox"
                    checked={showWeights}
                    onChange={(e) => setShowWeights(e.target.checked)}
                    className="accent-[#5BE39A]"
                  />
                </label>
              </div>
            )}
          </div>

          {(onSaveTree || onRegenerate || onRegenerateAI) && (
            <button
              onClick={() => {
                setLienzoOpen(false)
                if (editOpen) setEditOpen(false)
                else if (onRegenerateAI) openAIDrawer()
                else openDrawer()
              }}
              className="flex items-center gap-1.5 rounded-[11px] px-[15px] py-[9px] text-[12.5px] font-bold"
              style={{
                backdropFilter: "blur(6px)",
                border: "1px solid rgba(63,191,132,0.35)",
                background: editOpen ? "rgba(63,191,132,0.24)" : "rgba(63,191,132,0.14)",
                color: "#9FEDC4",
              }}
            >
              <Pencil className="h-3.5 w-3.5" />
              Editar mapa
            </button>
          )}
        </div>

        {editOpen && (
          <div
            onMouseDown={(e) => e.stopPropagation()}
            className="absolute bottom-0 right-0 top-0 z-[45] flex w-[340px] flex-col"
            style={{
              background: "rgba(11,15,13,0.97)",
              borderLeft: "1px solid rgba(255,255,255,0.09)",
              backdropFilter: "blur(10px)",
            }}
          >
            <div
              className="flex flex-none items-center justify-between px-5 py-[18px]"
              style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
            >
              <div className="flex items-center gap-2.5">
                {onRegenerateAI && (
                  <span
                    className="flex h-[30px] w-[30px] items-center justify-center rounded-[9px]"
                    style={{ background: "rgba(63,191,132,0.14)" }}
                  >
                    <Sparkles className="h-[15px] w-[15px] text-[#5BE39A]" />
                  </span>
                )}
                <div className="text-[14.5px] font-extrabold text-[#F2F6F4]">
                  {onRegenerateAI ? "Regenerar con IA" : "Editar mapa"}
                </div>
              </div>
              <button
                onClick={() => setEditOpen(false)}
                className="flex items-center justify-center"
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 8,
                  border: "1px solid rgba(255,255,255,0.09)",
                  color: "#9AA39E",
                }}
              >
                <X className="h-[15px] w-[15px]" />
              </button>
            </div>

            <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-[18px]">
              {/* Curso del mapa (design v3: course selection lives here) */}
              {courses && courses.length > 0 && onSelectCourse && (
                <div>
                  <div className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6FCB9A]">
                    Curso del mapa
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {courses.map((c) => {
                      const on = c.key === selectedCourseKey
                      return (
                        <button
                          key={c.key}
                          onClick={() => onSelectCourse(c.key)}
                          className="flex items-center gap-1.5 rounded-[9px] px-2.5 py-1.5 text-[11.5px] font-semibold"
                          style={{
                            border: `1px solid ${on ? "rgba(63,191,132,0.5)" : "rgba(255,255,255,0.1)"}`,
                            background: on ? "rgba(63,191,132,0.14)" : "transparent",
                            color: on ? "#E8EDEA" : "#9AA39E",
                          }}
                        >
                          <BookText
                            className="h-3.5 w-3.5 flex-none"
                            style={{ color: c.color ?? "#5BE39A" }}
                          />
                          <span className="max-w-[150px] truncate">{c.name}</span>
                          {c.count != null && (
                            <span className="rounded-full bg-white/10 px-1.5 text-[10px] tabular-nums">
                              {c.count}
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {onRegenerateAI && (
                <>
                  {(courseFiles?.length ?? 0) > 0 && (
                    <div>
                      <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6FCB9A]">
                        Archivos del curso
                      </div>
                      <div className="mb-2.5 text-[11.5px] leading-[1.4] text-[#7C8983]">
                        Elige qué documentos alimentan el mapa. Tu selección se guarda.
                      </div>
                      <div className="flex flex-col gap-1.5">
                        {courseFiles!.map((f) => {
                          const on = fileSel.has(f.id)
                          return (
                            <button
                              key={f.id}
                              onClick={() => setFileSel((s) => toggleIn(s, f.id))}
                              className="flex items-center gap-2.5 rounded-[10px] px-3 py-2 text-left text-[12px] font-semibold"
                              style={{
                                border: `1px solid ${on ? "rgba(63,191,132,0.45)" : "rgba(255,255,255,0.1)"}`,
                                background: on
                                  ? "rgba(63,191,132,0.08)"
                                  : "rgba(255,255,255,0.015)",
                                color: on ? "#E8EDEA" : "#9AA39E",
                              }}
                            >
                              <span
                                className="flex h-4 w-4 flex-none items-center justify-center rounded"
                                style={{
                                  border: `1px solid ${on ? "#5BE39A" : "rgba(255,255,255,0.25)"}`,
                                  background: on ? "rgba(63,191,132,0.25)" : "transparent",
                                }}
                              >
                                {on && <Check className="h-3 w-3 text-[#5BE39A]" />}
                              </span>
                              <FileText className="h-3.5 w-3.5 flex-none text-[#6FCB9A]" />
                              <span className="min-w-0 flex-1 truncate">
                                {f.name.replace(/\.(pdf|docx|pptx|xlsx)$/i, "")}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                      {fileSel.size === 0 && (
                        <div className="mt-1.5 text-[11px] text-[#F0A0A0]">
                          Selecciona al menos un documento.
                        </div>
                      )}
                    </div>
                  )}

                  {rootLabels.length > 0 && (
                    <div>
                      <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6FCB9A]">
                        Enfócate en temas
                      </div>
                      <div className="mb-2.5 text-[11.5px] leading-[1.4] text-[#7C8983]">
                        Selecciona los temas que quieres expandir con más detalle.
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {rootLabels.map((label) => {
                          const on = focusSel.has(label)
                          return (
                            <button
                              key={label}
                              onClick={() => setFocusSel((s) => toggleIn(s, label))}
                              className="rounded-[9px] px-2.5 py-1.5 text-[11.5px] font-semibold"
                              style={{
                                border: `1px solid ${on ? "rgba(63,191,132,0.5)" : "rgba(255,255,255,0.1)"}`,
                                background: on ? "rgba(63,191,132,0.14)" : "transparent",
                                color: on ? "#9FEDC4" : "#9AA39E",
                              }}
                            >
                              {label}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  <div>
                    <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6FCB9A]">
                      Recomendaciones
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {recos.map((r) => (
                        <button
                          key={r}
                          onClick={() =>
                            setInstructions((t) => (t.trim() ? `${t.trim()}\n${r}` : r))
                          }
                          className="rounded-[10px] px-3 py-2 text-left text-[11.5px] font-medium leading-[1.4] text-[#C9D2CD]"
                          style={{
                            border: "1px solid rgba(255,255,255,0.08)",
                            background: "rgba(255,255,255,0.015)",
                          }}
                        >
                          {r}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6FCB9A]">
                      Instrucciones
                    </div>
                    <textarea
                      value={instructions}
                      onChange={(e) => setInstructions(e.target.value)}
                      maxLength={600}
                      placeholder="Escribe cómo quieres regenerar el mapa… ej. enfatiza las relaciones entre conceptos, usa lenguaje sencillo."
                      className="min-h-[88px] w-full resize-y rounded-xl px-3 py-2.5 text-[12.5px] leading-[1.5] text-[#E8EDEA] outline-none placeholder:text-[#5F6A64]"
                      style={{
                        border: "1px solid rgba(255,255,255,0.1)",
                        background: "rgba(255,255,255,0.02)",
                      }}
                    />
                  </div>

                  <button
                    onClick={fireRegenerateAI}
                    disabled={fileSel.size === 0}
                    className="flex w-full items-center justify-center gap-2 rounded-xl py-[12px] text-[13.5px] font-bold disabled:opacity-50"
                    style={{
                      background: "linear-gradient(135deg,#3FBF84,#2c9a66)",
                      color: "#06140D",
                      boxShadow: "0 6px 20px rgba(63,191,132,0.25)",
                    }}
                  >
                    <RotateCcw className="h-4 w-4" />
                    Regenerar mapa
                  </button>

                  {onSaveTree && (
                    <button
                      onClick={() => setManualOpen((o) => !o)}
                      className="flex items-center justify-between rounded-[10px] px-3 py-2 text-[11.5px] font-bold text-[#9AA39E]"
                      style={{ border: "1px solid rgba(255,255,255,0.08)" }}
                    >
                      Edición manual de temas
                      <ChevronDown
                        className="h-3.5 w-3.5"
                        style={{ transform: manualOpen ? "rotate(180deg)" : undefined }}
                      />
                    </button>
                  )}
                </>
              )}

              {(!onRegenerateAI || manualOpen) && onSaveTree && (
                <div>
                  <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6FCB9A]">
                    Temas del mapa
                  </div>
                  <div className="mb-2.5 text-[11.5px] leading-[1.4] text-[#7C8983]">
                    Renombra, reordena, elimina o añade subtemas en cualquier nivel.
                  </div>

                  {pendingDeleteId ? (
                    <div
                      className="rounded-xl p-3"
                      style={{
                        border: "1px solid rgba(240,160,160,0.35)",
                        background: "rgba(240,160,160,0.08)",
                      }}
                    >
                      <p className="text-[12px] leading-[1.4] text-[#F0C7C7]">
                        Se eliminará este tema y sus {countDescendants(pendingDeleteId)} subtemas.
                        ¿Continuar?
                      </p>
                      <div className="mt-2.5 flex gap-2">
                        <button
                          onClick={confirmDelete}
                          className="flex-1 rounded-lg py-1.5 text-[11.5px] font-bold"
                          style={{
                            background: "rgba(240,160,160,0.18)",
                            color: "#F0A0A0",
                            border: "1px solid rgba(240,160,160,0.4)",
                          }}
                        >
                          Eliminar
                        </button>
                        <button
                          onClick={() => setPendingDeleteId(null)}
                          className="flex-1 rounded-lg py-1.5 text-[11.5px] font-bold text-[#9AA39E]"
                          style={{ border: "1px solid rgba(255,255,255,0.1)" }}
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      {draftRoots.map((r) => (
                        <TreeRow
                          key={r.id}
                          node={r}
                          depth={0}
                          draftNodes={draftNodes}
                          onRename={renameDirect}
                          onAddChild={(pid) =>
                            applyEdit({ type: "add", parentId: pid, label: "Nuevo tema" })
                          }
                          onDelete={requestDelete}
                          onMove={(id, dir) => applyEdit({ type: "reorder", id, direction: dir })}
                        />
                      ))}
                      <div className="mt-1 flex items-center gap-2">
                        <input
                          value={newRootLabel}
                          onChange={(e) => setNewRootLabel(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && addRoot()}
                          placeholder="Nueva rama principal…"
                          className="min-w-0 flex-1 rounded-[9px] px-3 py-2 text-xs font-semibold text-[#E8EDEA] outline-none"
                          style={{
                            border: "1px solid rgba(255,255,255,0.1)",
                            background: "rgba(255,255,255,0.02)",
                          }}
                        />
                        <button
                          onClick={addRoot}
                          disabled={!newRootLabel.trim()}
                          title="Añadir rama"
                          className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-lg text-[#9FEDC4] disabled:opacity-40"
                          style={{ border: "1px solid rgba(63,191,132,0.35)" }}
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  )}

                  {saveErr && (
                    <div className="mt-2 text-[11.5px] leading-[1.4] text-[#F0A0A0]">{saveErr}</div>
                  )}
                  <button
                    onClick={save}
                    disabled={saving || !draftValid || !!pendingDeleteId}
                    className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl py-[10px] text-[12.5px] font-bold disabled:opacity-50"
                    style={{
                      border: "1px solid rgba(63,191,132,0.45)",
                      background: "rgba(63,191,132,0.14)",
                      color: "#9FEDC4",
                    }}
                  >
                    {saving ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Check className="h-3.5 w-3.5" />
                    )}
                    Guardar cambios
                  </button>
                </div>
              )}

              {!onRegenerateAI && onRegenerate && (
                <div>
                  <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6FCB9A]">
                    Regenerar
                  </div>
                  <div className="mb-2.5 text-[11.5px] leading-[1.4] text-[#7C8983]">
                    Vuelve a generar el mapa completo desde el documento (se pierden los cambios
                    manuales).
                  </div>
                  <button
                    onClick={() => {
                      setEditOpen(false)
                      onRegenerate()
                    }}
                    className="flex w-full items-center justify-center gap-2 rounded-xl py-[10px] text-[12.5px] font-bold text-[#C9D2CD]"
                    style={{ border: "1px solid rgba(255,255,255,0.1)" }}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Regenerar desde cero
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* right-center vertical toolbar (design v3: select / add / connect / delete) */}
        {onSaveTree && (
          <div
            className="absolute right-4 top-1/2 z-[19] flex -translate-y-1/2 flex-col items-center gap-1.5 rounded-2xl p-2"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "rgba(12,16,14,0.9)",
              border: "1px solid rgba(255,255,255,0.09)",
              backdropFilter: "blur(8px)",
              boxShadow: "0 10px 30px rgba(0,0,0,0.4)",
            }}
          >
            {(
              [
                { t: "select" as const, title: "Seleccionar", icon: MousePointer2 },
                { t: "add" as const, title: "Añadir subtema (clic en un nodo)", icon: SquarePlus },
                { t: "connect" as const, title: "Conectar dos nodos", icon: Link2 },
              ] as const
            ).map(({ t, title, icon: Icon }) => (
              <button
                key={t}
                onClick={() => pickTool(tool === t ? "select" : t)}
                title={title}
                className="flex h-9 w-9 items-center justify-center rounded-[11px]"
                style={{
                  border: `1px solid ${tool === t ? "rgba(63,191,132,0.5)" : "transparent"}`,
                  background: tool === t ? "rgba(63,191,132,0.16)" : "transparent",
                  color: tool === t ? "#9FEDC4" : "#C9D2CD",
                }}
              >
                <Icon className="h-[18px] w-[18px]" />
              </button>
            ))}
            <div className="my-0.5 h-px w-[26px]" style={{ background: "rgba(255,255,255,0.1)" }} />
            <button
              onClick={() => pickTool(tool === "delete" ? "select" : "delete")}
              title="Eliminar nodo"
              className="flex h-9 w-9 items-center justify-center rounded-[11px]"
              style={{
                border: `1px solid ${tool === "delete" ? "rgba(240,160,160,0.5)" : "transparent"}`,
                background: tool === "delete" ? "rgba(240,160,160,0.14)" : "transparent",
                color: tool === "delete" ? "#F0A6A6" : "#C9D2CD",
              }}
            >
              <Trash2 className="h-[18px] w-[18px]" />
            </button>
            {undoSnap && !toolBusy && (
              <>
                <div
                  className="my-0.5 h-px w-[26px]"
                  style={{ background: "rgba(255,255,255,0.1)" }}
                />
                <button
                  onClick={undoLast}
                  title="Deshacer el último cambio"
                  className="flex h-9 w-9 items-center justify-center rounded-[11px] text-[#9FEDC4]"
                  style={{
                    border: "1px solid rgba(63,191,132,0.4)",
                    background: "rgba(63,191,132,0.12)",
                  }}
                >
                  <Undo2 className="h-[18px] w-[18px]" />
                </button>
              </>
            )}
            {toolBusy && <Loader2 className="h-4 w-4 animate-spin text-[#5BE39A]" />}
          </div>
        )}

        {/* tool hints */}
        {(tool === "connect" || tool === "add" || tool === "delete" || toolErr) && (
          <div
            className="absolute left-1/2 top-[14px] z-[21] -translate-x-1/2 rounded-full px-3.5 py-1.5 text-[11.5px] font-semibold"
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              background: "rgba(12,16,14,0.92)",
              border: `1px solid ${toolErr ? "rgba(240,160,160,0.4)" : "rgba(63,191,132,0.35)"}`,
              color: toolErr ? "#F0A0A0" : "#9FEDC4",
              backdropFilter: "blur(6px)",
              whiteSpace: "nowrap",
            }}
          >
            {toolErr ??
              (tool === "add"
                ? "Haz clic en un nodo para añadirle un subtema"
                : tool === "connect"
                  ? connectFrom
                    ? "Ahora haz clic en el nodo destino"
                    : "Haz clic en el nodo origen de la conexión"
                  : "Haz clic en el nodo que quieres eliminar")}
          </div>
        )}

        {/* inline node editor (add child label / rename) — positioned over the node */}
        {inlineEdit &&
          (() => {
            const p = result.positions.get(inlineEdit.nodeId)
            if (!p) return null
            const x = p.x * zoom + pan.x
            const y = p.y * zoom + pan.y
            const isAdd = inlineEdit.mode === "add"
            return (
              <div
                className="absolute z-[27] w-[190px] -translate-x-1/2 rounded-[11px] p-2"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                style={{
                  left: Math.max(100, Math.min(x, viewW - 100)),
                  top: Math.max(10, Math.min(y + (isAdd ? 30 : -22), viewH - 60)),
                  background: "rgba(11,15,13,0.98)",
                  border: "1px solid rgba(63,191,132,0.45)",
                  boxShadow: "0 14px 36px rgba(0,0,0,0.5)",
                }}
              >
                <input
                  value={inlineEdit.value}
                  autoFocus
                  maxLength={80}
                  onChange={(e) => setInlineEdit((s) => (s ? { ...s, value: e.target.value } : s))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitInline()
                    else if (e.key === "Escape") setInlineEdit(null)
                  }}
                  // Cancel (not commit) on blur — commit is Enter-only, so a
                  // blur fired by the Enter-unmount can't double-create.
                  onBlur={() => setInlineEdit(null)}
                  placeholder={isAdd ? "Nuevo subtema…" : "Renombrar…"}
                  className="w-full rounded-[8px] px-2.5 py-1.5 text-[12px] font-semibold text-[#E8EDEA] outline-none placeholder:text-[#5F6A64]"
                  style={{
                    border: "1px solid rgba(255,255,255,0.12)",
                    background: "rgba(255,255,255,0.03)",
                  }}
                />
                <div className="mt-1 text-center text-[9.5px] text-[#5F6A64]">
                  Enter para guardar · Esc para cancelar
                </div>
              </div>
            )
          })()}

        {deleteId && (
          <div
            className="absolute left-1/2 top-[52px] z-[26] w-[300px] -translate-x-1/2 rounded-[14px] p-3.5"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "rgba(11,15,13,0.98)",
              border: "1px solid rgba(240,160,160,0.35)",
              boxShadow: "0 14px 36px rgba(0,0,0,0.5)",
            }}
          >
            <p className="text-[12px] leading-[1.45] text-[#F0C7C7]">
              Se eliminará «{nodes.find((n) => n.id === deleteId)?.label}»
              {descendantCount(deleteId) > 0 ? ` y sus ${descendantCount(deleteId)} subtemas` : ""}.
              ¿Continuar?
            </p>
            <div className="mt-2.5 flex gap-2">
              <button
                onClick={() => {
                  const id = deleteId
                  setDeleteId(null)
                  pickTool("select")
                  void quickEdit({ type: "delete", id })
                }}
                className="flex-1 rounded-lg py-1.5 text-[11.5px] font-bold"
                style={{
                  background: "rgba(240,160,160,0.18)",
                  color: "#F0A0A0",
                  border: "1px solid rgba(240,160,160,0.4)",
                }}
              >
                Eliminar
              </button>
              <button
                onClick={() => setDeleteId(null)}
                className="flex-1 rounded-lg py-1.5 text-[11.5px] font-bold text-[#9AA39E]"
                style={{ border: "1px solid rgba(255,255,255,0.1)" }}
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        {/* zoom controls */}
        <div className="absolute bottom-[18px] left-[18px] z-[18] flex flex-col items-center gap-1.5">
          <div
            className="flex flex-col overflow-hidden rounded-xl"
            style={{
              border: "1px solid rgba(255,255,255,0.09)",
              background: "rgba(12,16,14,0.85)",
              backdropFilter: "blur(6px)",
            }}
          >
            <button
              onClick={() => zoomBy(1.2)}
              title="Acercar"
              className="flex h-[38px] w-[38px] items-center justify-center text-[#C9D2CD]"
              style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}
            >
              <Plus className="h-[17px] w-[17px]" />
            </button>
            <button
              onClick={() => zoomBy(1 / 1.2)}
              title="Alejar"
              className="flex h-[38px] w-[38px] items-center justify-center text-[#C9D2CD]"
              style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}
            >
              <Minus className="h-[17px] w-[17px]" />
            </button>
            <button
              onClick={zoomReset}
              title="Centrar / ajustar"
              className="flex h-[38px] w-[38px] items-center justify-center text-[#9AA39E]"
            >
              <Maximize className="h-4 w-4" />
            </button>
          </div>
          <span
            className="font-mono text-[11px] text-[#7C8983]"
            style={{
              background: "rgba(12,16,14,0.85)",
              padding: "3px 8px",
              borderRadius: 7,
              border: "1px solid rgba(255,255,255,0.07)",
            }}
          >
            {Math.round(zoom * 100)}%
          </span>
        </div>

        {/* bottom-center: ask about this map (question bar + answer bubble + chips) */}
        {onAsk && (
          <div
            className="absolute bottom-[18px] left-1/2 z-[20] flex -translate-x-1/2 flex-col gap-2"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            style={{ width: "min(620px,56vw)" }}
          >
            {askOpen && (
              <div
                className="rounded-2xl px-4 py-3.5"
                style={{
                  border: "1px solid rgba(63,191,132,0.28)",
                  background: "rgba(12,16,14,0.96)",
                  backdropFilter: "blur(10px)",
                  boxShadow: "0 12px 34px rgba(0,0,0,0.5)",
                }}
              >
                <div className="flex items-center gap-2">
                  <Sparkles className="h-3.5 w-3.5 flex-none text-[#5BE39A]" />
                  <span className="min-w-0 flex-1 truncate text-[11.5px] font-bold text-[#7C8983]">
                    {askQ || "Pregunta sobre el mapa"}
                  </span>
                  <button
                    onClick={() => setAskOpen(false)}
                    className="flex h-6 w-6 flex-none items-center justify-center rounded-[7px] text-[#7C8983] hover:bg-white/5 hover:text-[#C9D2CD]"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
                <div className="mt-2 text-[13px] leading-[1.55] text-[#DDE5E1]">
                  {askBusy ? (
                    <span className="flex items-center gap-2 text-[#7C8983]">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Pensando…
                    </span>
                  ) : askErr ? (
                    <span className="text-[#F0A0A0]">{askErr}</span>
                  ) : (
                    askTxt
                  )}
                </div>
              </div>
            )}

            {askOpen && (
              <div className="flex flex-wrap justify-center gap-1.5">
                <AskChip icon={AlignLeft} label="Más conciso" disabled={!canRefine} onClick={() => runAsk({ refine: "concise", previousAnswer: askTxt })} />
                <AskChip icon={AlignJustify} label="Añadir detalles" disabled={!canRefine} onClick={() => runAsk({ refine: "detail", previousAnswer: askTxt })} />
                <div className="relative">
                  <AskChip
                    icon={Languages}
                    label="Traducir a"
                    trailing={<ChevronDown className="h-3 w-3" />}
                    disabled={!canRefine}
                    onClick={() => setLangOpen((o) => !o)}
                  />
                  {langOpen && (
                    <div
                      className="absolute bottom-[38px] left-1/2 flex w-[150px] -translate-x-1/2 flex-col gap-0.5 rounded-xl p-1.5"
                      style={{
                        background: "rgba(14,18,16,0.97)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        boxShadow: "0 14px 36px rgba(0,0,0,0.5)",
                        backdropFilter: "blur(8px)",
                      }}
                    >
                      {LANGS.map((lg) => (
                        <button
                          key={lg}
                          onClick={() => runAsk({ refine: "translate", previousAnswer: askTxt, lang: lg })}
                          className="rounded-lg px-2.5 py-2 text-left text-[12.5px] font-semibold text-[#C9D2CD] hover:bg-white/5 hover:text-[#F2F6F4]"
                        >
                          {lg}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <AskChip
                  icon={RotateCcw}
                  label="Regenerar"
                  disabled={!askQ || askBusy}
                  onClick={() => runAsk({ question: askQ, refine: "regenerate" })}
                />
              </div>
            )}

            <div
              className="flex items-center gap-2.5 rounded-2xl py-2 pl-[15px] pr-2"
              style={{
                border: "1px solid rgba(255,255,255,0.11)",
                background: "rgba(12,16,14,0.94)",
                backdropFilter: "blur(10px)",
                boxShadow: "0 12px 34px rgba(0,0,0,0.5)",
              }}
            >
              <Sparkles className="h-[15px] w-[15px] flex-none text-[#5BE39A]" />
              <input
                value={ask}
                onChange={(e) => setAsk(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendAsk()}
                placeholder="Pregunta sobre este mapa mental…"
                className="min-w-0 flex-1 bg-transparent text-[13.5px] text-[#E8EDEA] outline-none placeholder:text-[#5F6A64]"
              />
              <button
                onClick={sendAsk}
                title="Enviar"
                disabled={!ask.trim() || askBusy}
                className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[10px] text-[#06140D] disabled:opacity-50"
                style={{
                  background: "linear-gradient(135deg,#3FBF84,#2c9a66)",
                  boxShadow: "0 4px 14px rgba(63,191,132,0.22)",
                }}
              >
                {askBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </button>
            </div>
          </div>
        )}

        {/* minimap */}
        {result.width > 0 && result.height > 0 && (
          <div
            className="pointer-events-none absolute bottom-[18px] right-[18px] z-[18] overflow-hidden rounded-[13px]"
            style={{
              width: 168,
              height: 100,
              border: "1px solid rgba(255,255,255,0.1)",
              background: "rgba(8,11,9,0.92)",
              backdropFilter: "blur(6px)",
            }}
          >
            {(() => {
              const inset = 7
              const boxW = 168 - inset * 2
              const boxH = 100 - inset * 2
              const s = Math.min(boxW / result.width, boxH / result.height)
              const offX = inset + (boxW - result.width * s) / 2
              const offY = inset + (boxH - result.height * s) / 2
              // Visible world rect (canvas → world): [-pan/zoom, (−pan+view)/zoom].
              const vx = (-pan.x / zoom) * s + offX
              const vy = (-pan.y / zoom) * s + offY
              const vw = (viewW / zoom) * s
              const vh = (viewH / zoom) * s
              return (
                <>
                  {flat.map((node) => {
                    const p = result.positions.get(node.id)
                    if (!p) return null
                    return (
                      <div
                        key={`mm-${node.id}`}
                        style={{
                          position: "absolute",
                          left: offX + p.x * s - 1.5,
                          top: offY + p.y * s - 1.5,
                          width: 3,
                          height: 3,
                          borderRadius: 999,
                          background: colorOf(node),
                          opacity: 0.85,
                        }}
                      />
                    )
                  })}
                  <div
                    style={{
                      position: "absolute",
                      left: vx,
                      top: vy,
                      width: vw,
                      height: vh,
                      border: "1px solid rgba(91,227,154,0.7)",
                      borderRadius: 4,
                      background: "rgba(91,227,154,0.08)",
                    }}
                  />
                </>
              )
            })()}
          </div>
        )}

        {loading && (
          <div
            className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-[18px]"
            style={{ background: "rgba(8,11,9,0.86)", backdropFilter: "blur(3px)" }}
          >
            <Loader2 className="h-[46px] w-[46px] animate-spin text-[#5BE39A]" />
            <div className="text-center">
              <div className="text-[14.5px] font-bold text-[#E8EDEA]">Procesando mapa…</div>
              <div className="mt-[5px] text-xs text-[#7C8983]">
                Analizando los temas y sus relaciones.
              </div>
            </div>
          </div>
        )}

        {!loading && roots.length === 0 && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center px-8 text-center">
            <p className="max-w-sm text-sm text-[#7C8983]">
              Aún no hay temas en el mapa. Sube y procesa el programa de tu curso para generar el
              mapa mental.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function AskChip({
  icon: Icon,
  label,
  onClick,
  disabled = false,
  trailing,
}: {
  icon: typeof AlignLeft
  label: string
  onClick: () => void
  disabled?: boolean
  trailing?: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-semibold text-[#C9D2CD] disabled:opacity-40"
      style={{
        border: "1px solid rgba(255,255,255,0.1)",
        background: "rgba(12,16,14,0.9)",
        backdropFilter: "blur(6px)",
      }}
    >
      <Icon className="h-3 w-3 flex-none" />
      {label}
      {trailing}
    </button>
  )
}

function TreeRow({
  node,
  depth,
  draftNodes,
  onRename,
  onAddChild,
  onDelete,
  onMove,
}: {
  node: TreeNodeDTO
  depth: number
  draftNodes: TreeNodeDTO[]
  onRename: (id: string, label: string) => void
  onAddChild: (parentId: string) => void
  onDelete: (id: string) => void
  onMove: (id: string, direction: "up" | "down") => void
}) {
  const children = draftNodes.filter((n) => n.parentId === node.id)
  return (
    <div>
      <div className="flex items-center gap-1.5" style={{ paddingLeft: depth * 14 }}>
        <input
          value={node.label}
          onChange={(e) => onRename(node.id, e.target.value)}
          aria-label="Nombre del tema"
          className="min-w-0 flex-1 rounded-[9px] px-2.5 py-1.5 text-[11.5px] font-semibold text-[#E8EDEA] outline-none"
          style={{
            border: "1px solid rgba(255,255,255,0.1)",
            background: "rgba(255,255,255,0.02)",
          }}
        />
        <div
          className="flex h-[26px] flex-none flex-col overflow-hidden rounded-lg"
          style={{ border: "1px solid rgba(255,255,255,0.09)" }}
        >
          <button
            onClick={() => onMove(node.id, "up")}
            title="Subir"
            className="flex h-[13px] w-[22px] items-center justify-center text-[#9AA39E] hover:text-[#9FEDC4]"
          >
            <ChevronUp className="h-2.5 w-2.5" />
          </button>
          <button
            onClick={() => onMove(node.id, "down")}
            title="Bajar"
            className="flex h-[13px] w-[22px] items-center justify-center text-[#9AA39E] hover:text-[#9FEDC4]"
          >
            <ChevronDown className="h-2.5 w-2.5" />
          </button>
        </div>
        <button
          onClick={() => onAddChild(node.id)}
          title="Añadir subtema"
          className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-lg text-[#9FEDC4]"
          style={{ border: "1px solid rgba(63,191,132,0.3)" }}
        >
          <Plus className="h-3 w-3" />
        </button>
        <button
          onClick={() => onDelete(node.id)}
          title="Eliminar"
          className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-lg text-[#9AA39E] hover:text-[#F0A0A0]"
          style={{ border: "1px solid rgba(255,255,255,0.09)" }}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
      {children.map((c) => (
        <TreeRow
          key={c.id}
          node={c}
          depth={depth + 1}
          draftNodes={draftNodes}
          onRename={onRename}
          onAddChild={onAddChild}
          onDelete={onDelete}
          onMove={onMove}
        />
      ))}
    </div>
  )
}
