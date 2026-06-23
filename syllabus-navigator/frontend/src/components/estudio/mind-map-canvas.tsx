"use client"

import { CSSProperties, useState } from "react"
import type { StudySetAPI } from "@/lib/api"
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
} from "lucide-react"

type Mindmap = StudySetAPI["mindmap"]
export type MindCourse = { id: string; code: string; label: string }

// Branch palette — matches the Navigator design (green / blue / purple / amber).
const PALETTE = ["#5BE39A", "#6FB6F0", "#C9A0F0", "#F0C27C"]
// Fixed branch slots inside the 980×540 world.
const BPOS = [
  { x: 430, y: 96 },
  { x: 726, y: 172 },
  { x: 726, y: 344 },
  { x: 430, y: 420 },
]
// Where edges leave the center node (its right-middle).
const C_ANCHOR = { x: 200, y: 274 }

type Tool = "select" | "add" | "connect" | "text" | "color" | "layout" | "lock" | "export" | "del"

// rgba() from a #rrggbb hex + alpha.
function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

export function MindMapCanvas({
  mindmap,
  courses,
  activeCourseId,
  onPickCourse,
  courseCode,
  courseName,
  loading = false,
  onRegenerate,
}: {
  mindmap: Mindmap
  courses: MindCourse[]
  activeCourseId: string
  onPickCourse: (id: string) => void
  courseCode: string
  courseName: string
  loading?: boolean
  onRegenerate?: (opts: { focus: string[]; instructions: string }) => void
}) {
  // viewport
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [drag, setDrag] = useState<{ x: number; y: number; px: number; py: number } | null>(null)
  // selection / expansion
  const [selNode, setSelNode] = useState<string | null>(null)
  const [exp, setExp] = useState<Record<string, boolean>>({})
  // chrome
  const [tool, setTool] = useState<Tool>("select")
  const [toolsOpen, setToolsOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [focus, setFocus] = useState<string[]>([])
  const [editText, setEditText] = useState("")

  const branches = mindmap.branches.slice(0, 4)

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
  const panStart = (e: React.MouseEvent) => setDrag({ x: e.clientX, y: e.clientY, px: pan.x, py: pan.y })
  const panMove = (e: React.MouseEvent) => {
    if (!drag) return
    setPan({ x: drag.px + (e.clientX - drag.x), y: drag.py + (e.clientY - drag.y) })
  }
  const panEnd = () => setDrag(null)

  const toggleNode = (id: string) => {
    setExp((e) => ({ ...e, [id]: !e[id] }))
    setSelNode((s) => (exp[id] ? (s === id ? null : s) : id))
  }
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
  const mmDots = [
    { x: 17, y: 42, c: "#5BE39A" },
    { x: 80, y: 13, c: PALETTE[0] },
    { x: 127, y: 32, c: PALETTE[1] },
    { x: 127, y: 60, c: PALETTE[2] },
    { x: 80, y: 75, c: PALETTE[3] },
  ]

  return (
    <div>
      {/* course picker — "Mapa de:" */}
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-xs font-semibold text-[#7C8983]">Mapa de:</span>
        {courses.map((c) => {
          const active = c.id === activeCourseId
          return (
            <button
              key={c.id}
              onClick={() => onPickCourse(c.id)}
              className="flex items-center gap-1.5 rounded-[10px] border px-3 py-1.5 transition-colors"
              style={{
                borderColor: active ? "rgba(63,191,132,0.4)" : "rgba(255,255,255,0.08)",
                background: active ? "rgba(63,191,132,0.1)" : "rgba(255,255,255,0.015)",
                color: active ? "#EEF3F0" : "#9AA39E",
              }}
            >
              <span className="font-mono text-[10.5px] font-semibold" style={{ color: active ? "#3FBF84" : "#6B756F" }}>
                {c.code}
              </span>
              <span className="text-[12.5px] font-semibold">{c.label}</span>
            </button>
          )
        })}
      </div>

      {/* CANVAS */}
      <div
        onMouseDown={panStart}
        onMouseMove={panMove}
        onMouseUp={panEnd}
        onMouseLeave={panEnd}
        className="relative mt-4 overflow-hidden rounded-[20px] border"
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
        <div style={worldStyle}>
          <svg width={980} height={540} style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none", overflow: "visible" }}>
            {branches.map((_, i) => {
              const color = PALETTE[i % 4]
              const id = "b" + i
              const p = BPOS[i]
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
            onClick={() => setSelNode((s) => (s === "center" ? null : "center"))}
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
              boxShadow: centerSel ? "0 0 40px rgba(63,191,132,0.32)" : "0 0 30px rgba(63,191,132,0.14)",
              transition: "all .18s",
            }}
          >
            <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#6FCB9A]">Tema central</span>
            <span className="mt-1.5 text-[15px] font-extrabold leading-tight text-[#F2F6F4]">{mindmap.center}</span>
          </div>

          {/* branch nodes */}
          {branches.map((b, i) => {
            const color = PALETTE[i % 4]
            const id = "b" + i
            const p = BPOS[i]
            const isSel = sel === id
            const allOn = sel === "center"
            const dim = !!sel && !isSel && !allOn
            const isExp = !!exp[id]
            return (
              <div
                key={id}
                style={{
                  position: "absolute",
                  left: p.x,
                  top: p.y,
                  width: 214,
                  borderRadius: 15,
                  padding: "12px 14px",
                  cursor: "pointer",
                  border: `1px solid ${isSel ? hexA(color, 0.6) : "rgba(255,255,255,0.09)"}`,
                  background: isSel
                    ? `linear-gradient(160deg,${hexA(color, 0.13)},rgba(16,21,18,0.96))`
                    : "rgba(17,22,19,0.94)",
                  boxShadow: isSel ? `0 0 30px ${hexA(color, 0.25)}` : "0 10px 26px rgba(0,0,0,0.4)",
                  opacity: dim ? 0.4 : 1,
                  backdropFilter: "blur(3px)",
                  transition: "border-color .18s,background .18s,box-shadow .18s,opacity .18s",
                }}
              >
                <div onClick={() => toggleNode(id)} className="flex cursor-pointer items-center gap-2.5">
                  <span className="flex-none" style={{ width: 9, height: 9, borderRadius: 3, background: color }} />
                  <span className="flex-1 text-sm font-bold text-[#EEF3F0]">{b.label}</span>
                  <ChevronRight
                    className="inline-flex h-[15px] w-[15px]"
                    style={{
                      transition: "transform .18s",
                      transform: isExp ? "rotate(90deg)" : "rotate(0deg)",
                      color: isSel ? hexA(color, 0.95) : "#7C8983",
                    }}
                  />
                </div>
                {isExp && (
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {b.items.map((it, j) => (
                      <span
                        key={j}
                        className="text-[11.5px] font-medium text-[#B7C0BB]"
                        style={{
                          background: "rgba(255,255,255,0.05)",
                          border: "1px solid rgba(255,255,255,0.08)",
                          padding: "4px 10px",
                          borderRadius: 7,
                        }}
                      >
                        {it}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* edit button */}
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

        {/* AI edit drawer */}
        {editOpen && (
          <div
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
                  style={{ width: 30, height: 30, borderRadius: 9, background: "rgba(63,191,132,0.14)" }}
                >
                  <Sparkles className="h-[15px] w-[15px] text-[#5BE39A]" />
                </span>
                <div>
                  <div className="text-[14.5px] font-extrabold text-[#F2F6F4]">Regenerar con IA</div>
                  <div className="mt-px text-[11px] text-[#7C8983]">
                    {courseCode} · {courseName}
                  </div>
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
              {/* course */}
              <div>
                <div className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6FCB9A]">Curso del mapa</div>
                <div className="flex flex-wrap gap-1.5">
                  {courses.map((c) => {
                    const active = c.id === activeCourseId
                    return (
                      <button
                        key={c.id}
                        onClick={() => onPickCourse(c.id)}
                        className="flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-[12.5px] font-semibold"
                        style={{
                          border: `1px solid ${active ? "rgba(63,191,132,0.4)" : "rgba(255,255,255,0.08)"}`,
                          background: active ? "rgba(63,191,132,0.1)" : "rgba(255,255,255,0.015)",
                          color: active ? "#EEF3F0" : "#9AA39E",
                        }}
                      >
                        <span className="font-mono text-[10.5px] font-semibold" style={{ color: active ? "#3FBF84" : "#6B756F" }}>
                          {c.code}
                        </span>
                        <span>{c.label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* focus topics */}
              <div>
                <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6FCB9A]">Enfócate en temas</div>
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
                <div className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6FCB9A]">Recomendaciones</div>
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
                      style={{ border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.015)" }}
                    >
                      <Lightbulb className="mt-px h-3.5 w-3.5 flex-none text-[#7CE0AC]" />
                      <span>{t}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* instructions */}
              <div>
                <div className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6FCB9A]">Instrucciones</div>
                <textarea
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  placeholder="Escribe cómo quieres regenerar el mapa… ej. enfatiza las relaciones entre conceptos, usa lenguaje sencillo."
                  className="min-h-[88px] w-full resize-y rounded-xl px-[13px] py-3 text-[13px] leading-[1.5] text-[#E8EDEA] outline-none"
                  style={{ border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.02)" }}
                />
              </div>
            </div>

            <div className="flex-none px-5 py-4" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
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
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                Regenerar mapa
              </button>
            </div>
          </div>
        )}

        {/* zoom controls */}
        <div className="absolute bottom-[18px] left-[18px] flex flex-col items-center gap-1.5">
          <div
            className="flex flex-col overflow-hidden rounded-xl"
            style={{ border: "1px solid rgba(255,255,255,0.09)", background: "rgba(12,16,14,0.85)", backdropFilter: "blur(6px)" }}
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
            <button onClick={zoomReset} title="Centrar / ajustar" className="flex h-[38px] w-[38px] items-center justify-center text-[#9AA39E]">
              <Maximize className="h-4 w-4" />
            </button>
          </div>
          <span
            className="font-mono text-[11px] text-[#7C8983]"
            style={{ background: "rgba(12,16,14,0.85)", padding: "3px 8px", borderRadius: 7, border: "1px solid rgba(255,255,255,0.07)" }}
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
          <button onClick={() => setTool("select")} title="Seleccionar" style={toolBtn(tool === "select")}>
            <MousePointer2 className="h-[18px] w-[18px]" />
          </button>
          <button onClick={() => setTool("add")} title="Añadir nodo" style={toolBtn(tool === "add")}>
            <SquarePlus className="h-[18px] w-[18px]" />
          </button>
          <button onClick={() => setTool("connect")} title="Conectar" style={toolBtn(tool === "connect")}>
            <Spline className="h-[18px] w-[18px]" />
          </button>
          <button onClick={() => setTool("text")} title="Texto / nota" style={toolBtn(tool === "text")}>
            <Type className="h-[18px] w-[18px]" />
          </button>
          <div style={{ width: 1, height: 26, background: "rgba(255,255,255,0.1)", margin: "0 2px" }} />
          <div className="relative">
            <button onClick={() => setToolsOpen((o) => !o)} title="Más herramientas" style={toolBtn(toolsOpen)}>
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
                <ToolMenuItem icon={<Palette className="h-4 w-4 text-[#9FEDC4]" />} label="Color de nodo" onClick={() => setTool("color")} />
                <ToolMenuItem icon={<LayoutGrid className="h-4 w-4 text-[#9FEDC4]" />} label="Auto-organizar" onClick={() => setTool("layout")} />
                <ToolMenuItem icon={<Lock className="h-4 w-4 text-[#9FEDC4]" />} label="Bloquear lienzo" onClick={() => setTool("lock")} />
                <ToolMenuItem icon={<Download className="h-4 w-4 text-[#9FEDC4]" />} label="Exportar imagen" onClick={() => setTool("export")} />
                <ToolMenuItem icon={<Trash2 className="h-4 w-4 text-[#F0A6A6]" />} label="Eliminar nodo" danger onClick={() => setTool("del")} />
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
            {mmDots.map((d, i) => (
              <div key={i} className="absolute" style={{ left: d.x, top: d.y, width: 7, height: 7, borderRadius: 2, background: d.c }} />
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
              <div className="mt-[5px] text-xs text-[#7C8983]">Analizando temas del knowledge base de {courseCode}</div>
            </div>
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
