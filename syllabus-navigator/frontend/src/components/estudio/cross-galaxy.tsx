"use client"

import { useMemo, useState, type CSSProperties } from "react"
import { Plus, Minus, Maximize, ArrowUpRight } from "lucide-react"
import type { CrossGraphAPI } from "@/lib/api"

// Block layout constants — each course is a column: a header bar + its topics
// stacked as rows underneath, so per-course material reads like its own small
// mind map while shared-concept/prerequisite lines still connect across columns.
const BLOCK_W = 210
const BLOCK_GAP = 100 // gives cross-course connector lines room to read clearly
const HEADER_H = 46
const ROW_H = 32
const ROW_GAP = 7
const PAD_TOP = 34
const PAD_BOTTOM = 30
const PAD_SIDE = 40
const MAX_TOPICS = 8 // cap rows per course so a block stays legible

type Pt = { x: number; y: number }

/**
 * Cross-course "galaxy": each course is its own vertical block (header + its
 * topics stacked as rows), laid out side by side. Solid lines are intra-course
 * prerequisites and dashed lines are shared concepts bridging courses — the
 * same edges as before, just drawn between block columns instead of orbiting
 * clusters. Click a course header → open its mind map.
 */
export function CrossGalaxy({
  graph,
  colorOf,
  onPickCourse,
}: {
  graph: CrossGraphAPI
  colorOf: Map<string, string>
  onPickCourse: (syllabusId: string) => void
}) {
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [drag, setDrag] = useState<{ x: number; y: number; px: number; py: number } | null>(null)
  const [hover, setHover] = useState<string | null>(null)

  // Deterministic layout: courses as columns (left→right), their top topics
  // stacked as rows inside each column.
  const { world, coursePos, nodePos, visibleNodes } = useMemo(() => {
    const courses = graph.courses
    const n = courses.length || 1

    const byCourse = new Map<string, CrossGraphAPI["nodes"]>()
    for (const node of graph.nodes) {
      const arr = byCourse.get(node.syllabus_id) ?? []
      arr.push(node)
      byCourse.set(node.syllabus_id, arr)
    }

    const visibleNodes = new Map<string, CrossGraphAPI["nodes"]>()
    let maxTopics = 0
    courses.forEach((c) => {
      const topics = (byCourse.get(c.syllabus_id) ?? [])
        .slice()
        .sort((a, b) => b.weight_percent - a.weight_percent)
        .slice(0, MAX_TOPICS)
      visibleNodes.set(c.syllabus_id, topics)
      maxTopics = Math.max(maxTopics, topics.length)
    })

    const totalBlocksW = n * BLOCK_W + (n - 1) * BLOCK_GAP
    const w = Math.max(900, totalBlocksW + PAD_SIDE * 2)
    const h = Math.max(
      420,
      PAD_TOP + HEADER_H + Math.max(maxTopics, 1) * (ROW_H + ROW_GAP) + PAD_BOTTOM,
    )
    const startX = (w - totalBlocksW) / 2

    const coursePos = new Map<string, Pt>()
    const nodePos = new Map<string, Pt>()
    courses.forEach((c, i) => {
      const bx = startX + i * (BLOCK_W + BLOCK_GAP)
      coursePos.set(c.syllabus_id, { x: bx, y: PAD_TOP })
      const topics = visibleNodes.get(c.syllabus_id) ?? []
      topics.forEach((t, j) => {
        nodePos.set(t.id, {
          x: bx + BLOCK_W / 2,
          y: PAD_TOP + HEADER_H + 14 + j * (ROW_H + ROW_GAP) + ROW_H / 2,
        })
      })
    })

    return { world: { w, h }, coursePos, nodePos, visibleNodes }
  }, [graph])

  // Edges we can actually draw (both endpoints visible).
  const edges = useMemo(
    () =>
      graph.edges
        .map((e) => ({ ...e, a: nodePos.get(e.source), b: nodePos.get(e.target) }))
        .filter((e) => e.a && e.b) as (CrossGraphAPI["edges"][number] & { a: Pt; b: Pt })[],
    [graph, nodePos],
  )

  const courseOfNode = useMemo(
    () => new Map(graph.nodes.map((n) => [n.id, n.syllabus_id])),
    [graph],
  )

  // Fit the block row into view by default; the user can still zoom/pan further.
  const fitZoom = Math.min(1, Math.max(0.35, 900 / world.w))
  const [zoom, setZoom] = useState(fitZoom)

  const zoomBy = (f: number) => setZoom((z) => Math.min(2.2, Math.max(0.3, +(z * f).toFixed(2))))
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
    width: world.w,
    height: world.h,
    transformOrigin: "0 0",
    transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})`,
    transition: drag ? "none" : "transform .18s ease",
  }

  const dimNode = (sid: string) => hover !== null && hover !== sid

  return (
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
          width={world.w}
          height={world.h}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            pointerEvents: "none",
            overflow: "visible",
          }}
        >
          {edges.map((e, i) => {
            const sid = courseOfNode.get(e.source)
            const color = colorOf.get(sid ?? "") ?? "#8aa"
            const shared = e.kind === "shared"
            const active =
              hover === null ||
              hover === courseOfNode.get(e.source) ||
              hover === courseOfNode.get(e.target)
            // Gentle S-curve so lines between non-adjacent columns stay readable.
            const midX = (e.a.x + e.b.x) / 2
            return (
              <path
                key={i}
                d={`M${e.a.x},${e.a.y} C${midX},${e.a.y} ${midX},${e.b.y} ${e.b.x},${e.b.y}`}
                fill="none"
                stroke={shared ? "rgba(159,237,196,0.8)" : color}
                strokeWidth={shared ? 1.6 : 1.4}
                strokeOpacity={active ? (shared ? 0.7 : 0.45) : 0.08}
                strokeDasharray={shared ? "5 5" : undefined}
                strokeLinecap="round"
              />
            )
          })}
        </svg>

        {/* course blocks */}
        {graph.courses.map((c) => {
          const p = coursePos.get(c.syllabus_id)!
          const color = colorOf.get(c.syllabus_id) ?? "#888"
          const topics = visibleNodes.get(c.syllabus_id) ?? []
          const dimmed = dimNode(c.syllabus_id)
          const blockH = HEADER_H + 14 + topics.length * (ROW_H + ROW_GAP)
          return (
            <div key={c.syllabus_id}>
              {/* block background — visually groups this course's rows */}
              <div
                className="absolute"
                style={{
                  left: p.x,
                  top: p.y,
                  width: BLOCK_W,
                  height: Math.max(blockH, HEADER_H),
                  borderRadius: 16,
                  background: `linear-gradient(180deg,${color}14 0%,${color}08 40%,transparent 85%)`,
                  border: `1px solid ${color}1f`,
                  opacity: dimmed ? 0.3 : 1,
                  transition: "opacity .18s",
                }}
              />

              {/* header → click opens this course's own mind map */}
              <button
                onClick={() => onPickCourse(c.syllabus_id)}
                onMouseEnter={() => setHover(c.syllabus_id)}
                onMouseLeave={() => setHover(null)}
                className="group absolute flex flex-col items-center justify-center"
                style={{
                  left: p.x,
                  top: p.y,
                  width: BLOCK_W,
                  height: HEADER_H,
                  borderRadius: 13,
                  cursor: "pointer",
                  textAlign: "center",
                  background: `linear-gradient(150deg,${color}26,rgba(16,21,18,0.96))`,
                  border: `1.5px solid ${color}`,
                  boxShadow: `0 0 22px ${color}2e`,
                  opacity: dimmed ? 0.45 : 1,
                  transition: "opacity .18s, box-shadow .18s",
                }}
              >
                <span className="flex items-center gap-1.5 px-2 text-[12.5px] font-extrabold text-[#F2F6F4]">
                  <span
                    className="h-2.5 w-2.5 flex-none rounded-sm"
                    style={{ background: color }}
                  />
                  <span className="truncate" style={{ maxWidth: BLOCK_W - 60 }}>
                    {c.course}
                  </span>
                </span>
                <span className="mt-0.5 flex items-center gap-1 text-[9.5px] font-semibold text-[#7C8983] opacity-0 transition-opacity group-hover:opacity-100">
                  Abrir mapa <ArrowUpRight className="h-2.5 w-2.5" />
                </span>
              </button>

              {/* topic rows */}
              {topics.map((t) => {
                const np = nodePos.get(t.id)!
                return (
                  <div
                    key={t.id}
                    title={
                      t.weight_percent > 0
                        ? `${t.label} · ${Math.round(t.weight_percent)}%`
                        : t.label
                    }
                    style={{
                      position: "absolute",
                      left: np.x,
                      top: np.y,
                      transform: "translate(-50%,-50%)",
                      width: BLOCK_W - 16,
                      height: ROW_H,
                      display: "flex",
                      alignItems: "center",
                      padding: "0 10px",
                      borderRadius: 9,
                      fontSize: 11,
                      fontWeight: 600,
                      lineHeight: 1.15,
                      color: "#D6DED9",
                      background: "rgba(17,22,19,0.92)",
                      border: `1px solid ${color}40`,
                      opacity: dimNode(c.syllabus_id) ? 0.2 : 1,
                      transition: "opacity .18s",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {t.label}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>

      {/* legend */}
      <div
        className="absolute left-[18px] top-[18px] flex flex-col gap-1.5 rounded-xl px-3 py-2.5 text-[11px]"
        style={{
          background: "rgba(12,16,14,0.85)",
          border: "1px solid rgba(255,255,255,0.08)",
          backdropFilter: "blur(6px)",
        }}
      >
        <span className="flex items-center gap-2 text-[#C9D2CD]">
          <span className="inline-block h-0.5 w-5 rounded bg-[#9AA39E]" /> prerrequisito
        </span>
        <span className="flex items-center gap-2 text-[#C9D2CD]">
          <span
            className="inline-block h-0 w-5 border-t-2 border-dashed"
            style={{ borderColor: "#9FEDC4" }}
          />{" "}
          concepto compartido
        </span>
      </div>

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
            className="flex h-[38px] w-[38px] items-center justify-center text-[#C9D2CD] hover:bg-white/5"
            style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}
          >
            <Plus className="h-[17px] w-[17px]" />
          </button>
          <button
            onClick={() => zoomBy(1 / 1.2)}
            title="Alejar"
            className="flex h-[38px] w-[38px] items-center justify-center text-[#C9D2CD] hover:bg-white/5"
            style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}
          >
            <Minus className="h-[17px] w-[17px]" />
          </button>
          <button
            onClick={zoomReset}
            title="Centrar / ajustar"
            className="flex h-[38px] w-[38px] items-center justify-center text-[#9AA39E] hover:bg-white/5"
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
    </div>
  )
}
