"use client"

import { CSSProperties, useRef, useState } from "react"
import {
  Plus,
  Minus,
  Maximize,
  MousePointer2,
  SquarePlus,
  Spline,
  Type,
  MoreHorizontal,
  Palette,
  LayoutGrid,
  Lock,
  Download,
  Trash2,
  Pencil,
  Sparkles,
  X,
  RotateCcw,
  Lightbulb,
  ChevronRight,
  Loader2,
  Expand,
  Shrink,
} from "lucide-react"

export type Mindmap = { center: string; branches: { label: string; items: string[] }[] }
export type MindCourse = { id: string; code: string; label: string }

// Branch palette — matches the Navigator design (green / blue / purple / amber).
const PALETTE = ["#5BE39A", "#6FB6F0", "#C9A0F0", "#F0C27C"]
// Where edges leave the center node (its right-middle).
const C_ANCHOR = { x: 200, y: 274 }
// Cap visible branches so the radial fan stays legible.
const MAX_BRANCHES = 8

type Tool = "select" | "add" | "connect" | "text" | "color" | "layout" | "lock" | "export" | "del"

// rgba() from a #rrggbb hex + alpha.
function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

// Distribute N branches vertically on the right with a two-column stagger so
// the fan looks organic (generalises the reference's fixed 4 slots).
function branchPos(i: number, n: number): { x: number; y: number } {
  const colX = [430, 726]
  const top = 70
  const bottom = 410
  const y = n > 1 ? top + (i * (bottom - top)) / (n - 1) : 200
  return { x: colX[i % 2], y: Math.round(y) }
}

export function MindMapCanvas({
  mindmap,
  courses = [],
  activeCourseId,
  onPickCourse,
  courseCode,
  courseName,
  loading = false,
  onRegenerate,
  onTopicDouble,
}: {
  mindmap: Mindmap
  /** Optional top course picker. Omit/empty to hide it (e.g. the /mapa page owns its own). */
  courses?: MindCourse[]
  activeCourseId?: string
  onPickCourse?: (id: string) => void
  courseCode?: string
  courseName?: string
  loading?: boolean
  onRegenerate?: (opts: { focus: string[]; instructions: string }) => void
  /** Double-click a node → send its label to the chat. */
  onTopicDouble?: (label: string) => void
}) {
  // viewport
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [drag, setDrag] = useState<{ x: number; y: number; px: number; py: number } | null>(null)
  // Did the pointer actually pan? Distinguishes a real drag from a click so a
  // click on the empty canvas can deselect without a pan being mistaken for one.
  const moved = useRef(false)
  // selection / expansion
  const [selNode, setSelNode] = useState<string | null>(null)
  const [exp, setExp] = useState<Record<string, boolean>>({})
  // chrome
  const [tool, setTool] = useState<Tool>("select")
  const [toolsOpen, setToolsOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [focus, setFocus] = useState<string[]>([])
  const [editText, setEditText] = useState("")

  const branches = mindmap.branches.slice(0, MAX_BRANCHES)
  const n = branches.length
  const showPicker = courses.length > 0 && !!onPickCourse

  const zoomBy = (f: number) => {
    setZoom((oz) => {
      const z = Math.min(2.2, Math.max(0.5, +(oz * f).toFixed(2)))
      const cx = 490
      const cy = 270
      setPan((p) => ({ x: p.x + cx * (oz - z), y: p.y + cy * (oz - z) }))
      return z
    })
  }
  const zoomReset = () => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }
  const panStart = (e: React.MouseEvent) => {
    moved.current = false
    setDrag({ x: e.clientX, y: e.clientY, px: pan.x, py: pan.y })
  }
  const panMove = (e: React.MouseEvent) => {
    if (!drag) return
    const dx = e.clientX - drag.x
    const dy = e.clientY - drag.y
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved.current = true
    setPan({ x: drag.px + dx, y: drag.py + dy })
  }
  const panEnd = () => setDrag(null)

  // Click on empty canvas (not a node, not after a pan) → exit: deselect and
  // collapse any open branch. Node clicks stopPropagation so they never reach this.
  const clearSelection = () => {
    if (moved.current) {
      moved.current = false
      return
    }
    setSelNode(null)
    setExp({})
  }

  const toggleNode = (id: string) => {
    setExp((e) => ({ ...e, [id]: !e[id] }))
    setSelNode((s) => (exp[id] ? (s === id ? null : s) : id))
  }
  const expandAll = () =>
    setExp(Object.fromEntries(branches.map((_, i) => ["b" + i, true] as const)))
  const collapseAll = () => {
    setExp({})
    setSelNode(null)
  }
  const anyExpanded = branches.some((_, i) => exp["b" + i])
  const toggleFocus = (t: string) =>
    setFocus((f) => (f.includes(t) ? f.filter((x) => x !== t) : [...f, t]))

  const regenerate = () => {
    setEditOpen(false)
    onRegenerate?.({ focus, instructions: editText.trim() })
  }

  const sel = selNode
  const centerSel = sel === "center"

  const toolBtn = (active: boolean): CSSProperties => ({
    width: 42,
    height: 42,
    borderRadius: 12,
    border: `1px solid ${active ? "rgba(63,191,132,0.45)" : "rgba(255,255,255,0.07)"}`,
    background: active ? "rgba(63,191,132,0.16)" : "transparent",
    color: active ? "#9FEDC4" : "#9AA39E",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    transition: "all .15s",
  })

  const worldStyle: CSSProperties = {
    position: "absolute",
    left: 0,
    top: 0,
    width: 980,
    height: 540,
    transformOrigin: "0 0",
    transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})`,
    transition: drag ? "none" : "transform .18s ease",
  }

  // minimap viewport rect
  const mmW = Math.min(152, 152 / zoom)
  const mmH = Math.min(86, 86 / zoom)
  const mmLeft = Math.max(0, Math.min(152 - mmW, -pan.x * 0.152))
  const mmTop = Math.max(0, Math.min(86 - mmH, -pan.y * 0.152))

  const subtitle = [courseCode, courseName].filter(Boolean).join(" · ") || mindmap.center

  return (
    <div>
      {/* course picker — "Mapa de:" (optional) */}
      {showPicker && (
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-xs font-semibold text-[#7C8983]">Mapa de:</span>
          {courses.map((c) => {
            const active = c.id === activeCourseId
            return (
              <button
                key={c.id}
                onClick={() => onPickCourse?.(c.id)}
                className="flex items-center gap-1.5 rounded-[10px] border px-3 py-1.5 transition-colors"
                style={{
                  borderColor: active ? "rgba(63,191,132,0.4)" : "rgba(255,255,255,0.08)",
                  background: active ? "rgba(63,191,132,0.1)" : "rgba(255,255,255,0.015)",
                  color: active ? "#EEF3F0" : "#9AA39E",
                }}
              >
                <span
                  className="font-mono text-[10.5px] font-semibold"
                  style={{ color: active ? "#3FBF84" : "#6B756F" }}
                >
                  {c.code}
                </span>
                <span className="text-[12.5px] font-semibold">{c.label}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* CANVAS */}
      <div
        onMouseDown={panStart}
        onMouseMove={panMove}
        onMouseUp={panEnd}
        onMouseLeave={panEnd}
        className={`relative overflow-hidden rounded-[20px] border ${showPicker ? "mt-4" : ""}`}
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
        {/* world: edges + nodes */}
        <div style={worldStyle} onClick={clearSelection}>
          <svg
            width={980}
            height={540}
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              pointerEvents: "none",
              overflow: "visible",
            }}
          >
            {branches.map((_, i) => {
              const color = PALETTE[i % 4]
              const id = "b" + i
              const p = branchPos(i, n)
              const ax = p.x
              const ay = p.y + (exp[id] ? 54 : 24)
              const isSel = sel === id
              const allOn = sel === "center"
              const edgeOn = isSel || allOn || !sel
              return (
                <path
                  key={id}
                  d={`M${C_ANCHOR.x},${C_ANCHOR.y} C${C_ANCHOR.x + (ax - C_ANCHOR.x) * 0.5},${C_ANCHOR.y} ${ax - 90},${ay} ${ax},${ay}`}
                  fill="none"
                  stroke={edgeOn ? color : "rgba(255,255,255,0.5)"}
                  strokeWidth={isSel || allOn ? 2.6 : 1.6}
                  strokeOpacity={edgeOn ? (!sel ? 0.65 : 1) : 0.1}
                  strokeLinecap="round"
                />
              )
            })}
          </svg>

          {/* center node */}
          <div
            onClick={(e) => {
              e.stopPropagation()
              setSelNode((s) => (s === "center" ? null : "center"))
            }}
            onDoubleClick={() => onTopicDouble?.(mindmap.center)}
            style={{
              position: "absolute",
              left: 30,
              top: 222,
              width: 170,
              height: 104,
              borderRadius: 18,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              textAlign: "center",
              padding: 14,
              cursor: "pointer",
              background: "linear-gradient(150deg,#1f3328,#13201a)",
              border: `1.5px solid ${centerSel ? "rgba(91,227,154,0.85)" : "rgba(63,191,132,0.5)"}`,
              boxShadow: centerSel
                ? "0 0 40px rgba(63,191,132,0.32)"
                : "0 0 30px rgba(63,191,132,0.14)",
              transition: "all .18s",
            }}
          >
            <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#6FCB9A]">
              Tema central
            </span>
            <span className="mt-1.5 text-[15px] font-extrabold leading-tight text-[#F2F6F4]">
              {mindmap.center}
            </span>
          </div>

          {/* branch nodes */}
          {branches.map((b, i) => {
            const color = PALETTE[i % 4]
            const id = "b" + i
            const p = branchPos(i, n)
            const isSel = sel === id
            const allOn = sel === "center"
            const dim = !!sel && !isSel && !allOn
            const isExp = !!exp[id]
            return (
              <div
                key={id}
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={() => onTopicDouble?.(b.label)}
                style={{
                  position: "absolute",
                  left: p.x,
                  top: p.y,
                  // Expanded nodes grow generously to use the open canvas space.
                  width: isExp ? 320 : 214,
                  zIndex: isExp ? 12 : 2,
                  borderRadius: 16,
                  padding: isExp ? "14px 16px" : "12px 14px",
                  cursor: "pointer",
                  border: `1px solid ${isSel || isExp ? hexA(color, 0.6) : "rgba(255,255,255,0.09)"}`,
                  background:
                    isSel || isExp
                      ? `linear-gradient(160deg,${hexA(color, 0.13)},rgba(16,21,18,0.97))`
                      : "rgba(17,22,19,0.94)",
                  boxShadow:
                    isSel || isExp
                      ? `0 0 34px ${hexA(color, 0.25)}`
                      : "0 10px 26px rgba(0,0,0,0.4)",
                  opacity: dim ? 0.4 : 1,
                  backdropFilter: "blur(3px)",
                  transition:
                    "width .2s ease,border-color .18s,background .18s,box-shadow .18s,opacity .18s",
                }}
              >
                <div
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleNode(id)
                  }}
                  className="flex cursor-pointer items-center gap-2.5"
                >
                  <span
                    className="flex-none"
                    style={{ width: 9, height: 9, borderRadius: 3, background: color }}
                  />
                  <span className="flex-1 text-sm font-bold leading-snug text-[#EEF3F0]">
                    {b.label}
                  </span>
                  <span
                    className="flex-none rounded-md px-1.5 font-mono text-[10px] font-semibold"
                    style={{ background: hexA(color, 0.14), color: hexA(color, 0.95) }}
                  >
                    {b.items.length}
                  </span>
                  <ChevronRight
                    className="inline-flex h-[15px] w-[15px]"
                    style={{
                      transition: "transform .18s",
                      transform: isExp ? "rotate(90deg)" : "rotate(0deg)",
                      color: isSel || isExp ? hexA(color, 0.95) : "#7C8983",
                    }}
                  />
                </div>
                {/* Expanded: subtopics as a readable, selectable list (highlight → ask the AI). */}
                {isExp && b.items.length > 0 && (
                  <ul
                    className="mt-3 flex flex-col gap-2 pt-3"
                    style={{ borderTop: `1px solid ${hexA(color, 0.18)}` }}
                  >
                    {b.items.map((it, j) => (
                      <li
                        key={j}
                        onMouseDown={(e) => e.stopPropagation()}
                        className="flex gap-2.5 text-[12.5px] leading-relaxed text-[#C9D2CD]"
                        style={{ userSelect: "text", cursor: "text" }}
                      >
                        <span
                          className="mt-[7px] h-1.5 w-1.5 flex-none rounded-full"
                          style={{ background: color }}
                        />
                        <span className="flex-1">{it}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {isExp && b.items.length === 0 && (
                  <div className="mt-2.5 text-[11px] italic text-[#7C8983]">Sin subtemas.</div>
                )}
              </div>
            )
          })}
        </div>

        {/* top-left: selection hint + strategic expand/collapse-all */}
        {n > 0 && (
          <div className="absolute left-[18px] top-[18px] flex flex-col items-start gap-1.5">
            <div
              className="pointer-events-none flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-[#9AA39E]"
              style={{
                background: "rgba(12,16,14,0.85)",
                border: "1px solid rgba(255,255,255,0.08)",
                backdropFilter: "blur(6px)",
              }}
            >
              <Sparkles className="h-3 w-3 text-[#7CE0AC]" />
              Subraya un subtema para preguntárselo a la IA
            </div>
            <div
              className="flex items-center overflow-hidden rounded-lg"
              style={{
                background: "rgba(12,16,14,0.85)",
                border: "1px solid rgba(255,255,255,0.08)",
                backdropFilter: "blur(6px)",
              }}
            >
              <button
                onMouseDown={(e) => e.stopPropagation()}
                onClick={expandAll}
                title="Expandir todos los temas"
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold text-[#9AA39E] transition-colors hover:bg-white/5 hover:text-[#C9D2CD]"
              >
                <Expand className="h-3 w-3" /> Expandir
              </button>
              <span style={{ width: 1, height: 18, background: "rgba(255,255,255,0.1)" }} />
              <button
                onMouseDown={(e) => e.stopPropagation()}
                onClick={collapseAll}
                disabled={!anyExpanded}
                title="Colapsar todos los temas"
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold text-[#9AA39E] transition-colors hover:bg-white/5 hover:text-[#C9D2CD] disabled:opacity-40"
              >
                <Shrink className="h-3 w-3" /> Colapsar
              </button>
            </div>
          </div>
        )}

        {/* edit button */}
        {onRegenerate && (
          <button
            onClick={() => {
              setEditOpen((o) => !o)
              setToolsOpen(false)
            }}
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

        {/* AI edit drawer */}
        {editOpen && (
          <div
            onMouseDown={(e) => e.stopPropagation()}
            className="absolute bottom-0 right-0 top-0 z-[25] flex w-[340px] flex-col"
            style={{
              background: "rgba(11,15,13,0.97)",
              borderLeft: "1px solid rgba(255,255,255,0.09)",
              backdropFilter: "blur(10px)",
              animation: "navPop .2s ease both",
            }}
          >
            <div
              className="flex flex-none items-center justify-between px-5 py-[18px]"
              style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
            >
              <div className="flex items-center gap-2.5">
                <span
                  className="flex items-center justify-center"
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 9,
                    background: "rgba(63,191,132,0.14)",
                  }}
                >
                  <Sparkles className="h-[15px] w-[15px] text-[#5BE39A]" />
                </span>
                <div>
                  <div className="text-[14.5px] font-extrabold text-[#F2F6F4]">
                    Regenerar con IA
                  </div>
                  <div className="mt-px text-[11px] text-[#7C8983]">{subtitle}</div>
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

            <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-5 py-[18px]">
              {/* focus topics */}
              <div>
                <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6FCB9A]">
                  Enfócate en temas
                </div>
                <div className="mb-2.5 text-[11.5px] leading-[1.4] text-[#7C8983]">
                  Selecciona los temas que quieres expandir con más detalle.
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {branches.map((b) => {
                    const on = focus.includes(b.label)
                    return (
                      <button
                        key={b.label}
                        onClick={() => toggleFocus(b.label)}
                        className="rounded-[9px] px-3 py-1.5 text-xs font-semibold"
                        style={{
                          border: `1px solid ${on ? "rgba(63,191,132,0.45)" : "rgba(255,255,255,0.1)"}`,
                          background: on ? "rgba(63,191,132,0.14)" : "transparent",
                          color: on ? "#9FEDC4" : "#9AA39E",
                        }}
                      >
                        {b.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* recommendations */}
              <div>
                <div className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6FCB9A]">
                  Recomendaciones
                </div>
                <div className="flex flex-col gap-2">
                  {[
                    `Profundiza en ${(branches[0]?.label ?? "el tema").toLowerCase()} con ejemplos.`,
                    "Conecta los temas con casos de la prueba corta.",
                    "Añade un nivel más de subtemas a cada rama.",
                  ].map((t) => (
                    <button
                      key={t}
                      onClick={() => setEditText(t)}
                      className="flex items-start gap-2.5 rounded-[11px] px-[13px] py-[11px] text-left text-[12.5px] font-medium leading-[1.4] text-[#C9D2CD]"
                      style={{
                        border: "1px solid rgba(255,255,255,0.08)",
                        background: "rgba(255,255,255,0.015)",
                      }}
                    >
                      <Lightbulb className="mt-px h-3.5 w-3.5 flex-none text-[#7CE0AC]" />
                      <span>{t}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* instructions */}
              <div>
                <div className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6FCB9A]">
                  Instrucciones
                </div>
                <textarea
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  placeholder="Escribe cómo quieres regenerar el mapa… ej. enfatiza las relaciones entre conceptos, usa lenguaje sencillo."
                  className="min-h-[88px] w-full resize-y rounded-xl px-[13px] py-3 text-[13px] leading-[1.5] text-[#E8EDEA] outline-none"
                  style={{
                    border: "1px solid rgba(255,255,255,0.1)",
                    background: "rgba(255,255,255,0.02)",
                  }}
                />
              </div>
            </div>

            <div
              className="flex-none px-5 py-4"
              style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
            >
              <button
                onClick={regenerate}
                disabled={loading}
                className="flex w-full items-center justify-center gap-2.5 rounded-xl py-[13px] text-sm font-bold disabled:opacity-60"
                style={{
                  background: "linear-gradient(135deg,#3FBF84,#2c9a66)",
                  color: "#06140D",
                  boxShadow: "0 6px 20px rgba(63,191,132,0.25)",
                }}
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RotateCcw className="h-4 w-4" />
                )}
                Regenerar mapa
              </button>
            </div>
          </div>
        )}

        {/* zoom controls */}
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

        {/* toolbar */}
        <div
          className="absolute bottom-[18px] left-1/2 flex -translate-x-1/2 items-center gap-1.5 p-2"
          style={{
            borderRadius: 16,
            background: "rgba(12,16,14,0.9)",
            border: "1px solid rgba(255,255,255,0.09)",
            backdropFilter: "blur(8px)",
            boxShadow: "0 10px 30px rgba(0,0,0,0.4)",
          }}
        >
          <button
            onClick={() => setTool("select")}
            title="Seleccionar"
            style={toolBtn(tool === "select")}
          >
            <MousePointer2 className="h-[18px] w-[18px]" />
          </button>
          <button
            onClick={() => setTool("add")}
            title="Añadir nodo"
            style={toolBtn(tool === "add")}
          >
            <SquarePlus className="h-[18px] w-[18px]" />
          </button>
          <button
            onClick={() => setTool("connect")}
            title="Conectar"
            style={toolBtn(tool === "connect")}
          >
            <Spline className="h-[18px] w-[18px]" />
          </button>
          <button
            onClick={() => setTool("text")}
            title="Texto / nota"
            style={toolBtn(tool === "text")}
          >
            <Type className="h-[18px] w-[18px]" />
          </button>
          <div
            style={{ width: 1, height: 26, background: "rgba(255,255,255,0.1)", margin: "0 2px" }}
          />
          <div className="relative">
            <button
              onClick={() => setToolsOpen((o) => !o)}
              title="Más herramientas"
              style={toolBtn(toolsOpen)}
            >
              <MoreHorizontal className="h-[18px] w-[18px]" />
            </button>
            {toolsOpen && (
              <div
                className="absolute bottom-[52px] right-0 flex w-[180px] flex-col gap-0.5 p-1.5"
                style={{
                  borderRadius: 14,
                  background: "rgba(14,18,16,0.97)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  boxShadow: "0 14px 36px rgba(0,0,0,0.5)",
                  backdropFilter: "blur(8px)",
                  animation: "navPop .18s ease both",
                }}
              >
                <ToolMenuItem
                  icon={<Palette className="h-4 w-4 text-[#9FEDC4]" />}
                  label="Color de nodo"
                  onClick={() => setTool("color")}
                />
                <ToolMenuItem
                  icon={<LayoutGrid className="h-4 w-4 text-[#9FEDC4]" />}
                  label="Auto-organizar"
                  onClick={() => setTool("layout")}
                />
                <ToolMenuItem
                  icon={<Lock className="h-4 w-4 text-[#9FEDC4]" />}
                  label="Bloquear lienzo"
                  onClick={() => setTool("lock")}
                />
                <ToolMenuItem
                  icon={<Download className="h-4 w-4 text-[#9FEDC4]" />}
                  label="Exportar imagen"
                  onClick={() => setTool("export")}
                />
                <ToolMenuItem
                  icon={<Trash2 className="h-4 w-4 text-[#F0A6A6]" />}
                  label="Eliminar nodo"
                  danger
                  onClick={() => setTool("del")}
                />
              </div>
            )}
          </div>
        </div>

        {/* minimap */}
        <div
          className="absolute bottom-[18px] right-[18px] overflow-hidden"
          style={{
            width: 168,
            height: 100,
            borderRadius: 13,
            border: "1px solid rgba(255,255,255,0.1)",
            background: "rgba(8,11,9,0.92)",
            backdropFilter: "blur(6px)",
          }}
        >
          <div className="absolute" style={{ inset: 7 }}>
            <div
              className="absolute"
              style={{
                left: 17,
                top: 42,
                width: 7,
                height: 7,
                borderRadius: 2,
                background: "#5BE39A",
              }}
            />
            {branches.map((b, i) => (
              <div
                key={i}
                className="absolute"
                style={{
                  left: 60 + (i % 4) * 28,
                  top: 12 + Math.floor(i / 4) * 30 + (i % 2) * 18,
                  width: 7,
                  height: 7,
                  borderRadius: 2,
                  background: PALETTE[i % 4],
                }}
              />
            ))}
            <div
              className="absolute"
              style={{
                left: mmLeft,
                top: mmTop,
                width: mmW,
                height: mmH,
                borderRadius: 4,
                border: "1.5px solid rgba(91,227,154,0.8)",
                background: "rgba(63,191,132,0.08)",
                pointerEvents: "none",
              }}
            />
          </div>
        </div>

        {/* processing overlay */}
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

        {/* empty state (no branches) */}
        {!loading && n === 0 && (
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
  icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-[11px] rounded-[9px] px-[11px] py-[9px] text-left text-[12.5px] font-semibold transition-colors hover:bg-white/[0.06]"
      style={{ color: danger ? "#F0A6A6" : "#C9D2CD" }}
    >
      {icon}
      {label}
    </button>
  )
}
