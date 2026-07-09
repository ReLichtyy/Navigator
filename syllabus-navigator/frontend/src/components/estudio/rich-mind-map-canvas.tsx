"use client"

import { useEffect, useMemo, useState, type CSSProperties } from "react"
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
  Check,
} from "lucide-react"
import type { GraphResponseAPI } from "@/types/api"
import { buildTree, flattenTree } from "./mind-map/build-tree"
import { runLayout } from "./mind-map/layouts"
import { sizeForLevel } from "./mind-map/types"
import {
  applyTreeEdits,
  type TreeNodeDTO,
  type CrossLinkDTO,
  type TreeEdit,
} from "@/lib/ui/graph-edit"

// rgba() from a #rrggbb hex + alpha — same helper as mind-map-canvas.tsx.
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
 * tree_horizontal / tree_vertical / columns_report). Sibling to the legacy
 * `MindMapCanvas` (untouched, still used by System B and legacy no-`layout`
 * graphs) rather than a branch inside it.
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
  const roots = useMemo(() => buildTree(nodes), [nodes])
  const flat = useMemo(() => flattenTree(roots), [roots])
  const result = useMemo(() => runLayout(layout, roots), [layout, roots])

  const fitZoom = Math.min(1, Math.max(0.3, 860 / result.width, 460 / result.height))
  const [zoom, setZoom] = useState(fitZoom)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [drag, setDrag] = useState<{ x: number; y: number; px: number; py: number } | null>(null)

  // Re-fit whenever the underlying data (and therefore world size) changes —
  // e.g. switching between documents.
  useEffect(() => {
    setZoom(fitZoom)
    setPan({ x: 0, y: 0 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result.width, result.height])

  const zoomBy = (f: number) => setZoom((z) => Math.min(2.2, Math.max(0.25, +(z * f).toFixed(2))))
  const zoomReset = () => {
    setZoom(fitZoom)
    setPan({ x: 0, y: 0 })
  }
  const panStart = (e: React.MouseEvent) =>
    setDrag({ x: e.clientX, y: e.clientY, px: pan.x, py: pan.y })
  const panMove = (e: React.MouseEvent) => {
    if (!drag) return
    setPan({ x: drag.px + (e.clientX - drag.x), y: drag.py + (e.clientY - drag.y) })
  }
  const panEnd = () => setDrag(null)

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
        onMouseDown={panStart}
        onMouseMove={panMove}
        onMouseUp={panEnd}
        onMouseLeave={panEnd}
        className="relative overflow-hidden rounded-[20px] border"
        style={{
          height: 560,
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
                return (
                  <path
                    key={`e-${node.id}`}
                    d={`M${a.x},${a.y} C${midX},${a.y} ${midX},${b.y} ${b.x},${b.y}`}
                    fill="none"
                    stroke={color}
                    strokeWidth={1.8}
                    strokeOpacity={0.55}
                    strokeLinecap="round"
                  />
                )
              })}
            {crossLinks.map((c, i) => {
              const a = result.positions.get(c.source)
              const b = result.positions.get(c.target)
              if (!a || !b) return null
              const midX = (a.x + b.x) / 2
              return (
                <path
                  key={`x-${i}`}
                  d={`M${a.x},${a.y} C${midX},${a.y} ${midX},${b.y} ${b.x},${b.y}`}
                  fill="none"
                  stroke="rgba(159,237,196,0.8)"
                  strokeWidth={1.6}
                  strokeDasharray="5 5"
                  strokeOpacity={0.75}
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
            return (
              <div
                key={node.id}
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
                  cursor: onTopicDouble ? "pointer" : "default",
                  border: `1px solid ${hexA(color, 0.5)}`,
                  background: `linear-gradient(160deg,${hexA(color, 0.13)},rgba(16,21,18,0.96))`,
                  boxShadow: "0 10px 24px rgba(0,0,0,0.4)",
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
                </div>
                {node.level === 1 && node.weightPercent != null && (
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

          {crossLinks.map((c, i) => {
            const a = result.positions.get(c.source)
            const b = result.positions.get(c.target)
            if (!a || !b) return null
            const midX = (a.x + b.x) / 2
            const midY = (a.y + b.y) / 2
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
                }}
              >
                {c.label}
              </div>
            )
          })}
        </div>

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

        {(onSaveTree || onRegenerate) && (
          <button
            onClick={() => (editOpen ? setEditOpen(false) : openDrawer())}
            className="absolute right-4 top-4 flex items-center gap-1.5 rounded-[11px] px-[15px] py-[9px] text-[12.5px] font-bold"
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
