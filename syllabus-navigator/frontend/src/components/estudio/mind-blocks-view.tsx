"use client"

import { useState } from "react"
import { ArrowDown, Loader2, Pencil, RotateCcw, Sparkles, X } from "lucide-react"
import type { MindMapMode } from "@/lib/api"
import { MIND_MODE_OPTIONS } from "./mind-mode-options"

export type MindBlock = { header: string; cards: { title: string; body: string }[] }

/**
 * Vertical block-report presentation for the "bloques" mind-map mode: 3+
 * headers, each with its own stack of cards, connected by a downward arrow —
 * for material that reads better as a sequence of sections than a branch tree.
 */
export function MindBlocksView({
  center,
  blocks,
  mode = "bloques",
  courseCode,
  courseName,
  loading = false,
  onRegenerate,
  onTopicDouble,
}: {
  center: string
  blocks: MindBlock[]
  mode?: MindMapMode
  courseCode?: string
  courseName?: string
  loading?: boolean
  onRegenerate?: (opts: { focus: string[]; instructions: string; mode?: MindMapMode }) => void
  onTopicDouble?: (label: string) => void
}) {
  const [editOpen, setEditOpen] = useState(false)
  const [editText, setEditText] = useState("")
  const [modeSel, setModeSel] = useState<MindMapMode>(mode)

  const toggleDrawer = () => {
    setEditOpen((o) => {
      if (!o) setModeSel(mode)
      return !o
    })
  }

  const regenerate = () => {
    setEditOpen(false)
    onRegenerate?.({
      focus: [],
      instructions: editText.trim(),
      mode: modeSel !== mode ? modeSel : undefined,
    })
  }

  const subtitle = [courseCode, courseName].filter(Boolean).join(" · ") || center

  return (
    <div>
      <div
        className="relative overflow-hidden rounded-[20px] border"
        style={{
          borderColor: "rgba(255,255,255,0.08)",
          backgroundColor: "#080B09",
        }}
      >
        <div className="flex items-center justify-between gap-3 px-6 py-5">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#6FCB9A]">
              Reporte
            </span>
            <div className="mt-1 text-[15px] font-extrabold leading-tight text-[#F2F6F4]">
              {center || "Reporte"}
            </div>
          </div>
          {onRegenerate && (
            <button
              onClick={toggleDrawer}
              className="flex flex-none items-center gap-1.5 rounded-[11px] px-[15px] py-[9px] text-[12.5px] font-bold"
              style={{
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

        {/* vertical flow: header + stacked cards per block, arrow between blocks */}
        <div className="flex flex-col items-center gap-0 px-6 pb-8">
          {blocks.map((b, i) => (
            <div key={i} className="flex w-full max-w-xl flex-col items-center">
              <div
                className="w-full rounded-t-xl px-4 py-2.5 text-center text-[13px] font-extrabold uppercase tracking-wide"
                style={{
                  background: "linear-gradient(150deg,#1f3328,#13201a)",
                  border: "1.5px solid rgba(63,191,132,0.5)",
                  color: "#9FEDC4",
                }}
              >
                {b.header}
              </div>
              <div
                className="flex w-full flex-col gap-2.5 rounded-b-xl border border-t-0 p-3.5"
                style={{
                  borderColor: "rgba(255,255,255,0.09)",
                  background: "rgba(17,22,19,0.94)",
                }}
              >
                {b.cards.map((c, j) => (
                  <div
                    key={j}
                    onDoubleClick={() => onTopicDouble?.(c.title)}
                    className="cursor-text rounded-lg px-3.5 py-3"
                    style={{
                      border: "1px solid rgba(255,255,255,0.08)",
                      background: "rgba(255,255,255,0.02)",
                    }}
                  >
                    <div className="text-[13px] font-bold text-[#EEF3F0]">{c.title}</div>
                    <div className="mt-1 text-[12.5px] leading-relaxed text-[#C9D2CD]">
                      {c.body}
                    </div>
                  </div>
                ))}
              </div>
              {i < blocks.length - 1 && (
                <ArrowDown className="my-2.5 h-5 w-5 flex-none text-[#3FBF84]" />
              )}
            </div>
          ))}
          {blocks.length === 0 && (
            <div className="py-10 text-center text-sm text-[#7C8983]">
              Aún no hay secciones en este reporte.
            </div>
          )}
        </div>

        {/* edit drawer */}
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
              <div>
                <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6FCB9A]">
                  Tipo de mapa
                </div>
                <div className="mb-2.5 text-[11.5px] leading-[1.4] text-[#7C8983]">
                  El automático se elige según el contenido; puedes forzar otro.
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {MIND_MODE_OPTIONS.map((o) => {
                    const on = modeSel === o.mode
                    return (
                      <button
                        key={o.mode}
                        onClick={() => setModeSel(o.mode)}
                        title={o.hint}
                        className="rounded-[9px] px-3 py-1.5 text-xs font-semibold"
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
              </div>

              <div>
                <div className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6FCB9A]">
                  Instrucciones
                </div>
                <textarea
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  placeholder="Escribe cómo quieres regenerar el reporte…"
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

        {/* processing overlay */}
        {loading && (
          <div
            className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-[18px]"
            style={{ background: "rgba(8,11,9,0.86)", backdropFilter: "blur(3px)" }}
          >
            <Loader2 className="h-[46px] w-[46px] animate-spin text-[#5BE39A]" />
            <div className="text-center">
              <div className="text-[14.5px] font-bold text-[#E8EDEA]">Procesando reporte…</div>
              <div className="mt-[5px] text-xs text-[#7C8983]">
                Analizando el material y sus secciones.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
