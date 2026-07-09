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

  // Reset navigation when the underlying document changes.
  useEffect(() => {
    setCollapsed(new Set())
    setFocusId(null)
    setSearch("")
    setExpandDepth(0)
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
  const result = useMemo(() => runLayout(layout, pruned), [layout, pruned])

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
    setDrag({ x: e.clientX, y: e.clientY, px: pan.x, py: pan.y })
  }
  const panMove = (e: React.MouseEvent) => {
    if (!drag) return
    if (Math.abs(e.clientX - drag.x) > 3 || Math.abs(e.clientY - drag.y) > 3) movedRef.current = true
    setPan({ x: drag.px + (e.clientX - drag.x), y: drag.py + (e.clientY - drag.y) })
  }
  const panEnd = () => setDrag(null)
  // Click on empty canvas (not a drag) clears the focus dim.
  const onCanvasClick = () => {
    if (!movedRef.current) setFocusId(null)
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
          cursor: drag ? "grabbing" : "grab",
          userSelect: "none",
        }}
      >
        <div style={worldStyle}>
          <svg
            width={result.width}
            height={result.height}
            style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none", overflow: "visible" }}
          >
            {layout !== "columns_report" &&
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
            const foldable = node.children.length > 0 || node.collapsedCount > 0
            const isCollapsed = node.collapsedCount > 0
            return (
              <div
                key={node.id}
                onClick={(e) => {
                  e.stopPropagation()
                  if (!movedRef.current) focusNode(node.id)
                }}
                onDoubleClick={() => onTopicDouble?.(node.label)}
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
                  border: `1px solid ${isMatch ? "#F0C27C" : isFocus ? hexA(color, 0.95) : hexA(color, 0.5)}`,
                  background: `linear-gradient(160deg,${hexA(color, isFocus ? 0.22 : 0.13)},rgba(16,21,18,0.96))`,
                  boxShadow: isMatch
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

          {(onSaveTree || onRegenerate) && (
            <button
              onClick={() => (editOpen ? setEditOpen(false) : openDrawer())}
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
              <div className="text-[14.5px] font-extrabold text-[#F2F6F4]">Editar mapa</div>
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
              {onSaveTree && (
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

              {onRegenerate && (
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
          style={{ border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.02)" }}
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
