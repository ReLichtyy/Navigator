"use client"

import { useMemo } from "react"
import { ArrowUpRight, CalendarClock, Link2, Flag } from "lucide-react"
import type { CrossGraphAPI, UpcomingAssessmentAPI } from "@/lib/api"

const MAX_PER_COURSE = 6

type Step = {
  id: string
  label: string
  weight: number
  isBase: boolean // no prerequisites → start here
  isShared: boolean // concept appears in more than one course
}

type CourseBlock = {
  syllabusId: string
  course: string
  color: string
  daysUntil: number | null
  assessment: string | null
  steps: Step[]
}

/** Kahn topological depth for a course's topics (roots = depth 0). */
function topoDepth(
  nodeIds: string[],
  edges: { source: string; target: string }[],
): Map<string, number> {
  const inSet = new Set(nodeIds)
  const inDeg = new Map(nodeIds.map((id) => [id, 0]))
  const children = new Map<string, string[]>(nodeIds.map((id) => [id, []]))
  for (const e of edges) {
    if (!inSet.has(e.source) || !inSet.has(e.target)) continue
    children.get(e.source)!.push(e.target)
    inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1)
  }
  const depth = new Map<string, number>()
  const queue = nodeIds.filter((id) => (inDeg.get(id) ?? 0) === 0)
  queue.forEach((id) => depth.set(id, 0))
  while (queue.length) {
    const cur = queue.shift()!
    const d = depth.get(cur) ?? 0
    for (const nx of children.get(cur) ?? []) {
      depth.set(nx, Math.max(depth.get(nx) ?? 0, d + 1))
      const left = (inDeg.get(nx) ?? 0) - 1
      inDeg.set(nx, left)
      if (left === 0) queue.push(nx)
    }
  }
  // any node not reached (cycles) → depth 0
  nodeIds.forEach((id) => {
    if (!depth.has(id)) depth.set(id, 0)
  })
  return depth
}

/**
 * Suggested cross-course learning route: orders topics by prerequisite depth
 * within each course, and orders courses by nearest assessment (soonest first),
 * flagging base topics and shared concepts.
 */
export function CrossRoadmap({
  graph,
  colorOf,
  assessments,
  onPickCourse,
}: {
  graph: CrossGraphAPI
  colorOf: Map<string, string>
  assessments: UpcomingAssessmentAPI[]
  onPickCourse: (syllabusId: string) => void
}) {
  const blocks = useMemo<CourseBlock[]>(() => {
    // label → set of courses it appears in (shared concept detection)
    const labelCourses = new Map<string, Set<string>>()
    for (const n of graph.nodes) {
      const k = n.label.trim().toLowerCase()
      const s = labelCourses.get(k) ?? new Set<string>()
      s.add(n.syllabus_id)
      labelCourses.set(k, s)
    }

    // nearest assessment per course (match by course name)
    const soonest = new Map<string, { days: number | null; title: string }>()
    for (const a of assessments) {
      if (a.days_until == null) continue
      const cur = soonest.get(a.course_name)
      if (!cur || (cur.days ?? Infinity) > a.days_until) {
        soonest.set(a.course_name, { days: a.days_until, title: a.title })
      }
    }

    const prereqEdges = graph.edges.filter((e) => e.kind === "prerequisite")

    const built = graph.courses.map((c) => {
      const nodes = graph.nodes.filter((n) => n.syllabus_id === c.syllabus_id)
      const ids = nodes.map((n) => n.id)
      const depth = topoDepth(ids, prereqEdges)
      const byId = new Map(nodes.map((n) => [n.id, n]))
      const ordered = ids
        .slice()
        .sort((a, b) => {
          const da = depth.get(a) ?? 0
          const db = depth.get(b) ?? 0
          if (da !== db) return da - db
          return (byId.get(b)!.weight_percent ?? 0) - (byId.get(a)!.weight_percent ?? 0)
        })
        .slice(0, MAX_PER_COURSE)

      const ass = soonest.get(c.course)
      return {
        syllabusId: c.syllabus_id,
        course: c.course,
        color: colorOf.get(c.syllabus_id) ?? "#888",
        daysUntil: ass?.days ?? null,
        assessment: ass?.title ?? null,
        steps: ordered.map((id) => {
          const n = byId.get(id)!
          return {
            id,
            label: n.label,
            weight: n.weight_percent,
            isBase: (depth.get(id) ?? 0) === 0,
            isShared: (labelCourses.get(n.label.trim().toLowerCase())?.size ?? 0) > 1,
          }
        }),
      }
    })

    // courses with a sooner assessment first; the rest keep their order
    return built.sort((a, b) => (a.daysUntil ?? 9999) - (b.daysUntil ?? 9999))
  }, [graph, colorOf, assessments])

  let stepNo = 0

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] text-muted-foreground">
        Orden sugerido para estudiar: primero los cursos con evaluación más próxima, y dentro de
        cada uno los temas base antes que los que dependen de ellos.
      </p>

      {blocks.map((b) => (
        <div key={b.syllabusId} className="rounded-2xl border border-border bg-card/50 p-4">
          {/* course header */}
          <div className="mb-3 flex flex-wrap items-center gap-2.5">
            <span className="h-3 w-3 flex-none rounded-sm" style={{ background: b.color }} />
            <button
              onClick={() => onPickCourse(b.syllabusId)}
              className="group flex items-center gap-1 text-sm font-extrabold text-foreground hover:text-accent"
              title="Abrir mapa mental del curso"
            >
              {b.course}
              <ArrowUpRight className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
            {b.daysUntil != null && (
              <span
                className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                  b.daysUntil <= 7
                    ? "bg-destructive/15 text-destructive"
                    : "bg-accent/10 text-accent"
                }`}
                title={b.assessment ?? undefined}
              >
                <CalendarClock className="h-3 w-3" />
                {b.daysUntil <= 0
                  ? "evaluación hoy"
                  : `examen en ${b.daysUntil} día${b.daysUntil === 1 ? "" : "s"}`}
              </span>
            )}
          </div>

          {/* ordered steps */}
          <ol className="flex flex-col gap-1.5">
            {b.steps.map((s) => {
              stepNo += 1
              return (
                <li key={s.id} className="flex items-center gap-3 rounded-lg px-1 py-1">
                  <span
                    className="flex h-6 w-6 flex-none items-center justify-center rounded-md font-mono text-[11px] font-bold"
                    style={{ background: `${b.color}1f`, color: b.color }}
                  >
                    {stepNo}
                  </span>
                  <span className="flex-1 text-sm font-medium text-foreground">{s.label}</span>
                  <div className="flex flex-none items-center gap-1.5">
                    {s.isBase && (
                      <span className="flex items-center gap-1 rounded-md bg-secondary/60 px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                        <Flag className="h-2.5 w-2.5" /> base
                      </span>
                    )}
                    {s.isShared && (
                      <span className="flex items-center gap-1 rounded-md bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                        <Link2 className="h-2.5 w-2.5" /> compartido
                      </span>
                    )}
                    {s.weight > 0 && (
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {Math.round(s.weight)}%
                      </span>
                    )}
                  </div>
                </li>
              )
            })}
            {b.steps.length === 0 && (
              <li className="px-1 py-1 text-[13px] italic text-muted-foreground">
                Sin temas indexados todavía.
              </li>
            )}
          </ol>
        </div>
      ))}
    </div>
  )
}
