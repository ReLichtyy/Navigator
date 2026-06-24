"use client"

import { useMemo, useState, type CSSProperties } from "react"
import { Plus, Minus, Maximize, ArrowUpRight } from "lucide-react"
import type { CrossGraphAPI } from "@/lib/api"

const WORLD = { w: 980, h: 540, cx: 490, cy: 270 }
const COURSE_RADIUS = 195 // distance of each course cluster from canvas center
const TOPIC_RADIUS = 78 // distance of topic nodes from their course center
const MAX_TOPICS = 8 // cap nodes per course so the galaxy stays legible

type Pt = { x: number; y: number }

/**
 * Cross-course "galaxy": each course is a colored cluster, topic nodes orbit
 * their course, solid lines are intra-course prerequisites and dashed lines are
 * shared concepts bridging courses. Click a course → open its mind map.
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
  const [zoom, setZoom] = useState(0.85)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [drag, setDrag] = useState<{ x: number; y: number; px: number; py: number } | null>(null)
  const [hover, setHover] = useState<string | null>(null)

  // Deterministic layout: courses on a ring, their top topics orbiting each.
  const { coursePos, nodePos, visibleNodes } = useMemo(() => {
    const coursePos = new Map<string, Pt>()
    const nodePos = new Map<string, Pt>()
    const visibleNodes = new Map<string, CrossGraphAPI["nodes"]>()

    const courses = graph.courses
    const nC = courses.length || 1

    const byCourse = new Map<string, CrossGraphAPI["nodes"]>()
    for (const n of graph.nodes) {
      const arr = byCourse.get(n.syllabus_id) ?? []
      arr.push(n)
      byCourse.set(n.syllabus_id, arr)
    }

    courses.forEach((c, i) => {
      const ang = (i / nC) * Math.PI * 2 - Math.PI / 2
      const ccx = WORLD.cx + Math.cos(ang) * (nC === 1 ? 0 : COURSE_RADIUS)
      const ccy = WORLD.cy + Math.sin(ang) * (nC === 1 ? 0 : COURSE_RADIUS)
      coursePos.set(c.syllabus_id, { x: ccx, y: ccy })

      const topics = (byCourse.get(c.syllabus_id) ?? [])
        .slice()
        .sort((a, b) => b.weight_percent - a.weight_percent)
        .slice(0, MAX_TOPICS)
      visibleNodes.set(c.syllabus_id, topics)

      const m = topics.length || 1
      topics.forEach((t, j) => {
        const ta = (j / m) * Math.PI * 2 + ang // bias the ring outward from center
        nodePos.set(t.id, {
          x: ccx + Math.cos(ta) * TOPIC_RADIUS,
          y: ccy + Math.sin(ta) * TOPIC_RADIUS,
        })
      })
    })

    return { coursePos, nodePos, visibleNodes }
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

  const zoomBy = (f: number) => setZoom((z) => Math.min(2.2, Math.max(0.4, +(z * f).toFixed(2))))
  const zoomReset = () => {
    setZoom(0.85)
    setPan({ x: 0, y: 0 })
  }
  const panStart = (e: React.MouseEvent) =>
    setDrag({ x: e.clientX, y: e.clientY, px: pan.x, py: pan.y })
  const panMove = (e: React.MouseEvent) => {
    if (!drag) return
    setPan({ x: drag.px + (e.clientX - drag.x), y: drag.py + (e.clientY - drag.y) })
  }
  const panEnd = () => setDrag(null)

  const world: CSSProperties = {
    position: "absolute",
    left: 0,
    top: 0,
    width: WORLD.w,
    height: WORLD.h,
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
      <div style={world}>
        <svg
          width={WORLD.w}
          height={WORLD.h}
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
            return (
              <line
                key={i}
                x1={e.a.x}
                y1={e.a.y}
                x2={e.b.x}
                y2={e.b.y}
                stroke={shared ? "rgba(159,237,196,0.8)" : color}
                strokeWidth={shared ? 1.6 : 1.4}
                strokeOpacity={active ? (shared ? 0.7 : 0.45) : 0.08}
                strokeDasharray={shared ? "5 5" : undefined}
                strokeLinecap="round"
              />
            )
          })}
        </svg>

        {/* course clusters */}
        {graph.courses.map((c) => {
          const p = coursePos.get(c.syllabus_id)!
          const color = colorOf.get(c.syllabus_id) ?? "#888"
          const topics = visibleNodes.get(c.syllabus_id) ?? []
          return (
            <div key={c.syllabus_id}>
              {/* topic nodes */}
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
                      maxWidth: 132,
                      padding: "5px 9px",
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

              {/* course center → click opens its mind map */}
              <button
                onClick={() => onPickCourse(c.syllabus_id)}
                onMouseEnter={() => setHover(c.syllabus_id)}
                onMouseLeave={() => setHover(null)}
                className="group absolute flex flex-col items-center justify-center"
                style={{
                  left: p.x,
                  top: p.y,
                  transform: "translate(-50%,-50%)",
                  width: 150,
                  minHeight: 56,
                  padding: "10px 14px",
                  borderRadius: 16,
                  cursor: "pointer",
                  textAlign: "center",
                  background: `linear-gradient(150deg,${color}26,rgba(16,21,18,0.96))`,
                  border: `1.5px solid ${color}`,
                  boxShadow: `0 0 28px ${color}33`,
                  opacity: dimNode(c.syllabus_id) ? 0.45 : 1,
                  transition: "opacity .18s, box-shadow .18s",
                }}
              >
                <span className="flex items-center gap-1.5 text-[13px] font-extrabold text-[#F2F6F4]">
                  <span
                    className="h-2.5 w-2.5 flex-none rounded-sm"
                    style={{ background: color }}
                  />
                  <span className="truncate" style={{ maxWidth: 104 }}>
                    {c.course}
                  </span>
                </span>
                <span className="mt-1 flex items-center gap-1 text-[10px] font-semibold text-[#7C8983] opacity-0 transition-opacity group-hover:opacity-100">
                  Abrir mapa <ArrowUpRight className="h-3 w-3" />
                </span>
              </button>
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
