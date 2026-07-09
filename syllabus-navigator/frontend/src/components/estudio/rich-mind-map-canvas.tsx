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
  Search,
  SlidersHorizontal,
  MousePointer2,
  SquarePlus,
  Link2,
  StickyNote,
  MoreHorizontal,
  Lock,
  Unlock,
  LayoutGrid,
  Download,
  Sparkles,
  FileText,
  Undo2,
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
}

/**
 * Renders the 3+ level hierarchical mind map (tree + prerequisite-independent
 * cross-links) across the 4 layouts the generator can choose (radial /
 * tree_horizontal / tree_vertical / columns_report). Navigation: collapse/
 * expand subtrees, click-to-focus (center + zoom, dims the rest), search/jump,
 * and view options (default depth, toggle cross-links, toggle weights). The
 * sole mind-map canvas — used by /mapa, /knowledge preview and the chat panel
 * via {@link GraphCanvas}; legacy flat graphs (no `layout`) render as radial.
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
}: Props) {
  const VIEW_H = 560
  const viewportRef = useRef<HTMLDivElement>(null)

  const roots = useMemo(() => buildTree(nodes), [nodes])
  const allFlat = useMemo(() => flattenTree(roots), [roots]) // every node (for search)
  const treeDepth = useMemo(() => roots.reduce((m, r) => Math.max(m, maxDepth(r)), 1), [roots])

  // --- navigation state (all local, not persisted) ---
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [focusId, setFocusId] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [searchIdx, setSearchIdx] = useState(0)
  const [optionsOpen, setOptionsOpen] = useState(false)
  // View options ("configuración"): default expansion depth + toggles.
  const [expandDepth, setExpandDepth] = useState(0) // 0 = show all levels
  const [showCrossLinks, setShowCrossLinks] = useState(true)
  const [showWeights, setShowWeights] = useState(true)

  // Local layout override ("Organizar" tool) — view-only, not persisted. null =
  // use the generator's chosen layout.
  const [layoutOverride, setLayoutOverride] = useState<GraphResponseAPI["layout"] | null>(null)
  const activeLayout = layoutOverride ?? layout

  // Reset navigation when the underlying document changes.
  useEffect(() => {
    setCollapsed(new Set())
    setFocusId(null)
    setSearch("")
    setExpandDepth(0)
    setLayoutOverride(null)
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

  // Search matches (over ALL nodes so a hidden match can be jumped to).
  const matchIds = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return [] as string[]
    return allFlat.filter((n) => n.label.toLowerCase().includes(q)).map((n) => n.id)
  }, [search, allFlat])
  const matchSet = useMemo(() => new Set(matchIds), [matchIds])

  const fitZoom = Math.min(1, Math.max(0.3, 860 / result.width, (VIEW_H - 100) / result.height))
  const [zoom, setZoom] = useState(fitZoom)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [drag, setDrag] = useState<{ x: number; y: number; px: number; py: number } | null>(null)
  const movedRef = useRef(false)

  // Re-fit whenever the world size changes (doc switch / collapse-expand).
  useEffect(() => {
    setZoom(fitZoom)
    setPan({ x: 0, y: 0 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result.width, result.height])

  const zoomBy = (f: number) => setZoom((z) => Math.min(2.2, Math.max(0.25, +(z * f).toFixed(2))))
  const zoomReset = () => {
    setFocusId(null)
    setZoom(fitZoom)
    setPan({ x: 0, y: 0 })
  }

  // Center + zoom onto a node (click-to-focus / search jump).
  const centerOn = (id: string) => {
    const p = result.positions.get(id)
    if (!p) return
    const vw = viewportRef.current?.clientWidth ?? 860
    const z = 1.15
    setZoom(z)
    setPan({ x: vw / 2 - p.x * z, y: VIEW_H / 2 - p.y * z })
  }
  const focusNode = (id: string) => {
    setFocusId(id)
    centerOn(id)
  }

  // Jump to a node possibly hidden inside a collapsed subtree: expand its
  // ancestors first, then focus once the layout has recomputed.
  const [pendingFocus, setPendingFocus] = useState<string | null>(null)
  const jumpTo = (id: string) => {
    const byId = new Map(allFlat.map((n) => [n.id, n]))
    const next = new Set(collapsed)
    let cur = byId.get(id)
    while (cur?.parentId) {
      next.delete(cur.parentId)
      cur = byId.get(cur.parentId)
    }
    setCollapsed(next)
    setPendingFocus(id)
  }
  useEffect(() => {
    if (pendingFocus && result.positions.has(pendingFocus)) {
      focusNode(pendingFocus)
      setPendingFocus(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, pendingFocus])

  const cycleSearch = () => {
    if (matchIds.length === 0) return
    const idx = searchIdx % matchIds.length
    jumpTo(matchIds[idx])
    setSearchIdx((i) => (i + 1) % matchIds.length)
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
    if (locked) return
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
  // connect pick / inline editor.
  const onCanvasClick = () => {
    if (movedRef.current) return
    setFocusId(null)
    if (connectFrom) setConnectFrom(null)
    if (inlineEdit) setInlineEdit(null)
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

  // --- structural editor (recursion-aware: any depth, not just roots) ---
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

  // --- canvas toolbar (design: seleccionar / añadir / conectar / nota / más) ---
  type Tool = "select" | "add" | "connect" | "note" | "delete"
  const [tool, setTool] = useState<Tool>("select")
  const [locked, setLocked] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [layoutMenuOpen, setLayoutMenuOpen] = useState(false)
  const [connectFrom, setConnectFrom] = useState<string | null>(null)
  const [noteId, setNoteId] = useState<string | null>(null)
  const [noteText, setNoteText] = useState("")
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
    setNoteId(null)
    setDeleteId(null)
    setInlineEdit(null)
    setMoreOpen(false)
    setLayoutMenuOpen(false)
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
      setNoteId(null)
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
    } else if (tool === "note") {
      setNoteId(id)
      setNoteText(nodes.find((n) => n.id === id)?.detail ?? "")
    } else if (tool === "delete") {
      const roots = nodes.filter((n) => n.parent_id === null)
      const isLastRoot = roots.length === 1 && roots[0].id === id
      if (isLastRoot) setToolErr("No puedes eliminar la única rama del mapa.")
      else setDeleteId(id)
    }
    return true
  }

  // PNG export: standalone SVG snapshot (edges + node boxes) rasterized 2x.
  const exportImage = () => {
    setMoreOpen(false)
    const pad = 40
    const esc = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    const parts: string[] = []
    for (const node of flat) {
      if (!node.parentId) continue
      const a = result.positions.get(node.parentId)
      const b = result.positions.get(node.id)
      if (!a || !b) continue
      const midX = (a.x + b.x) / 2
      parts.push(
        `<path d="M${a.x},${a.y} C${midX},${a.y} ${midX},${b.y} ${b.x},${b.y}" fill="none" stroke="${node.color ?? FALLBACK_COLOR}" stroke-width="1.8" stroke-opacity="0.55" stroke-linecap="round"/>`,
      )
    }
    for (const node of flat) {
      const pos = result.positions.get(node.id)
      if (!pos) continue
      const size = sizeForLevel(node.level)
      const color = node.color ?? FALLBACK_COLOR
      // Truncate to what fits the box (~6.6px per char at 12.5px) so long
      // labels don't spill outside the rect in the exported PNG.
      const maxChars = Math.max(4, Math.floor((size.w - 16) / 6.6))
      const text =
        node.label.length > maxChars ? `${node.label.slice(0, maxChars - 1)}…` : node.label
      parts.push(
        `<rect x="${pos.x - size.w / 2}" y="${pos.y - size.h / 2}" width="${size.w}" height="${size.h}" rx="14" fill="#101512" stroke="${color}" stroke-opacity="0.6"/>`,
        `<text x="${pos.x}" y="${pos.y + 4}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="12.5" font-weight="700" fill="#EEF3F0">${esc(text)}</text>`,
      )
    }
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${result.width + pad * 2}" height="${result.height + pad * 2}" viewBox="${-pad} ${-pad} ${result.width + pad * 2} ${result.height + pad * 2}">` +
      `<rect x="${-pad}" y="${-pad}" width="100%" height="100%" fill="#080B09"/>${parts.join("")}</svg>`
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement("canvas")
      canvas.width = (result.width + pad * 2) * 2
      canvas.height = (result.height + pad * 2) * 2
      const ctx = canvas.getContext("2d")
      if (!ctx) return
      ctx.scale(2, 2)
      ctx.drawImage(img, 0, 0)
      const a = document.createElement("a")
      a.href = canvas.toDataURL("image/png")
      a.download = `${(centerTitle ?? "mapa-mental").replace(/[^\p{L}\p{N}]+/gu, "-").toLowerCase()}.png`
      a.click()
    }
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
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

  return (
    <div>
      <div
        ref={viewportRef}
        onMouseDown={panStart}
        onMouseMove={panMove}
        onMouseUp={panEnd}
        onMouseLeave={panEnd}
        onClick={onCanvasClick}
        className="relative overflow-hidden rounded-[20px] border"
        style={{
          height: VIEW_H,
          borderColor: "rgba(255,255,255,0.08)",
          backgroundColor: "#080B09",
          backgroundImage: "radial-gradient(circle,rgba(255,255,255,0.045) 1px,transparent 1px)",
          backgroundSize: "28px 28px",
          cursor: drag ? "grabbing" : locked ? "default" : "grab",
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
                const color = node.color ?? FALLBACK_COLOR
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
            const color = node.color ?? FALLBACK_COLOR
            const title =
              node.detail ??
              (node.children[0] ? (node.children[0].detail ?? node.children[0].label) : undefined)
            const dimmed = !!highlight && !highlight.has(node.id)
            const isMatch = matchSet.has(node.id)
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
                  border: `1px solid ${isConnectSrc ? "#5BE39A" : isMatch ? "#F0C27C" : isFocus ? hexA(color, 0.95) : hexA(color, 0.5)}`,
                  background: `linear-gradient(160deg,${hexA(color, isFocus ? 0.22 : 0.13)},rgba(16,21,18,0.96))`,
                  boxShadow: isConnectSrc
                    ? "0 0 0 2px rgba(91,227,154,0.6), 0 10px 24px rgba(0,0,0,0.4)"
                    : isMatch
                      ? "0 0 0 2px rgba(240,194,124,0.5), 0 10px 24px rgba(0,0,0,0.4)"
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

        {/* top-left: title + search */}
        <div
          className="absolute left-[18px] top-[18px] flex flex-col items-start gap-2"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {centerTitle && (
            <div
              className="pointer-events-none rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-[#9AA39E]"
              style={{
                background: "rgba(12,16,14,0.85)",
                border: "1px solid rgba(255,255,255,0.08)",
                backdropFilter: "blur(6px)",
              }}
            >
              {centerTitle}
            </div>
          )}
          <div
            className="flex items-center gap-1.5 rounded-lg px-2 py-1"
            style={{
              background: "rgba(12,16,14,0.85)",
              border: "1px solid rgba(255,255,255,0.08)",
              backdropFilter: "blur(6px)",
            }}
          >
            <Search className="h-3.5 w-3.5 flex-none text-[#7C8983]" />
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setSearchIdx(0)
              }}
              onKeyDown={(e) => e.key === "Enter" && cycleSearch()}
              placeholder="Buscar tema…"
              className="w-[130px] bg-transparent text-[11.5px] font-semibold text-[#E8EDEA] outline-none placeholder:text-[#5F6A64]"
            />
            {search.trim() && (
              <span className="flex-none font-mono text-[10px] text-[#7C8983]">
                {matchIds.length}
              </span>
            )}
          </div>
        </div>

        {/* top-right: view options + edit */}
        <div
          className="absolute right-4 top-4 flex items-center gap-2"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="relative">
            <button
              onClick={() => setOptionsOpen((o) => !o)}
              title="Opciones de vista"
              className="flex h-[36px] w-[36px] items-center justify-center rounded-[11px] text-[#9FEDC4]"
              style={{
                backdropFilter: "blur(6px)",
                border: "1px solid rgba(63,191,132,0.35)",
                background: optionsOpen ? "rgba(63,191,132,0.24)" : "rgba(63,191,132,0.14)",
              }}
            >
              <SlidersHorizontal className="h-4 w-4" />
            </button>
            {optionsOpen && (
              <div
                className="absolute right-0 top-[42px] z-[24] w-[210px] rounded-xl p-3"
                style={{
                  background: "rgba(11,15,13,0.98)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  backdropFilter: "blur(10px)",
                }}
              >
                <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-[#6FCB9A]">
                  Profundidad
                </div>
                <div className="mb-3 flex gap-1">
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
              onClick={() =>
                editOpen ? setEditOpen(false) : onRegenerateAI ? openAIDrawer() : openDrawer()
              }
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
            className="absolute bottom-0 right-0 top-0 z-[25] flex w-[340px] flex-col"
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

        {/* bottom-center toolbar (design: seleccionar / añadir / conectar / nota / más) */}
        {onSaveTree && (
          <div
            className="absolute bottom-[18px] left-1/2 z-[20] flex -translate-x-1/2 items-center gap-1.5 rounded-2xl p-2"
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
                { t: "note" as const, title: "Nota del nodo", icon: StickyNote },
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
            <div className="mx-0.5 h-[26px] w-px" style={{ background: "rgba(255,255,255,0.1)" }} />
            <div className="relative">
              <button
                onClick={() => setMoreOpen((o) => !o)}
                title="Más herramientas"
                className="flex h-9 w-9 items-center justify-center rounded-[11px] text-[#C9D2CD]"
                style={{ background: moreOpen ? "rgba(255,255,255,0.06)" : "transparent" }}
              >
                <MoreHorizontal className="h-[18px] w-[18px]" />
              </button>
              {moreOpen && (
                <div
                  className="absolute bottom-[52px] right-0 z-[24] flex w-[190px] flex-col gap-0.5 rounded-[14px] p-1.5"
                  style={{
                    background: "rgba(14,18,16,0.97)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    boxShadow: "0 14px 36px rgba(0,0,0,0.5)",
                    backdropFilter: "blur(8px)",
                  }}
                >
                  <div className="relative">
                    <ToolMenuItem
                      icon={LayoutGrid}
                      label="Organizar"
                      trailing={<ChevronRight className="h-3.5 w-3.5" />}
                      onClick={() => setLayoutMenuOpen((o) => !o)}
                    />
                    {layoutMenuOpen && (
                      <div
                        className="absolute bottom-0 right-[184px] z-[25] flex w-[180px] flex-col gap-0.5 rounded-[14px] p-1.5"
                        style={{
                          background: "rgba(14,18,16,0.98)",
                          border: "1px solid rgba(255,255,255,0.1)",
                          boxShadow: "0 14px 36px rgba(0,0,0,0.5)",
                          backdropFilter: "blur(8px)",
                        }}
                      >
                        {(
                          [
                            { v: "radial" as const, label: "Radial" },
                            { v: "tree_horizontal" as const, label: "Árbol horizontal" },
                            { v: "tree_vertical" as const, label: "Árbol vertical" },
                            { v: "columns_report" as const, label: "Columnas" },
                          ] as const
                        ).map(({ v, label }) => (
                          <button
                            key={v}
                            onClick={() => {
                              setLayoutOverride(v)
                              setLayoutMenuOpen(false)
                              setMoreOpen(false)
                            }}
                            className="flex items-center justify-between rounded-[9px] px-2.5 py-2 text-left text-[12px] font-semibold"
                            style={{
                              color: activeLayout === v ? "#9FEDC4" : "#C9D2CD",
                              background:
                                activeLayout === v ? "rgba(63,191,132,0.12)" : "transparent",
                            }}
                          >
                            {label}
                            {activeLayout === v && <Check className="h-3.5 w-3.5" />}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <ToolMenuItem
                    icon={locked ? Unlock : Lock}
                    label={locked ? "Desbloquear lienzo" : "Bloquear lienzo"}
                    onClick={() => {
                      setLocked((l) => !l)
                      setMoreOpen(false)
                    }}
                  />
                  <ToolMenuItem icon={Download} label="Exportar imagen" onClick={exportImage} />
                  <ToolMenuItem
                    icon={Trash2}
                    label="Eliminar nodo"
                    danger
                    onClick={() => pickTool("delete")}
                  />
                </div>
              )}
            </div>
            {undoSnap && !toolBusy && (
              <button
                onClick={undoLast}
                title="Deshacer el último cambio"
                className="ml-1 flex h-9 items-center gap-1.5 rounded-[11px] px-2.5 text-[12px] font-bold text-[#9FEDC4]"
                style={{
                  border: "1px solid rgba(63,191,132,0.4)",
                  background: "rgba(63,191,132,0.12)",
                }}
              >
                <Undo2 className="h-4 w-4" />
                Deshacer
              </button>
            )}
            {toolBusy && <Loader2 className="ml-1 h-4 w-4 animate-spin text-[#5BE39A]" />}
          </div>
        )}

        {/* tool hints + note editor + delete confirm */}
        {(tool === "connect" ||
          tool === "add" ||
          tool === "note" ||
          tool === "delete" ||
          toolErr) && (
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
                  : tool === "note"
                    ? "Haz clic en un nodo para editar su nota"
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
                  left: Math.max(100, Math.min(x, (viewportRef.current?.clientWidth ?? 860) - 100)),
                  top: Math.max(10, Math.min(y + (isAdd ? 30 : -22), VIEW_H - 60)),
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

        {noteId && (
          <div
            className="absolute left-1/2 top-[52px] z-[26] w-[300px] -translate-x-1/2 rounded-[14px] p-3.5"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "rgba(11,15,13,0.98)",
              border: "1px solid rgba(255,255,255,0.1)",
              boxShadow: "0 14px 36px rgba(0,0,0,0.5)",
            }}
          >
            <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6FCB9A]">
              Nota — {nodes.find((n) => n.id === noteId)?.label}
            </div>
            <textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              maxLength={140}
              autoFocus
              placeholder="Detalle del tema (aparece al pasar el cursor)…"
              className="min-h-[70px] w-full resize-none rounded-[10px] px-2.5 py-2 text-[12px] leading-[1.45] text-[#E8EDEA] outline-none placeholder:text-[#5F6A64]"
              style={{
                border: "1px solid rgba(255,255,255,0.1)",
                background: "rgba(255,255,255,0.02)",
              }}
            />
            <div className="mt-1 text-right font-mono text-[9.5px] text-[#5F6A64]">
              {noteText.length}/140
            </div>
            <div className="mt-1.5 flex gap-2">
              <button
                onClick={() => {
                  const id = noteId
                  setNoteId(null)
                  void quickEdit({ type: "note", id, detail: noteText })
                }}
                className="flex-1 rounded-lg py-1.5 text-[11.5px] font-bold text-[#9FEDC4]"
                style={{
                  border: "1px solid rgba(63,191,132,0.45)",
                  background: "rgba(63,191,132,0.14)",
                }}
              >
                Guardar nota
              </button>
              <button
                onClick={() => setNoteId(null)}
                className="flex-1 rounded-lg py-1.5 text-[11.5px] font-bold text-[#9AA39E]"
                style={{ border: "1px solid rgba(255,255,255,0.1)" }}
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

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

        <div className="absolute bottom-[18px] left-[18px] flex flex-col items-center gap-1.5">
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

function ToolMenuItem({
  icon: Icon,
  label,
  onClick,
  danger = false,
  trailing,
}: {
  icon: typeof Trash2
  label: string
  onClick: () => void
  danger?: boolean
  trailing?: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-left text-[12px] font-semibold"
      style={{ color: danger ? "#F0A6A6" : "#C9D2CD" }}
    >
      <Icon className="h-4 w-4 flex-none" style={{ color: danger ? "#F0A6A6" : "#9FEDC4" }} />
      <span className="flex-1">{label}</span>
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
