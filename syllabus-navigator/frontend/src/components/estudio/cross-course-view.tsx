"use client"

import { useEffect, useMemo, useState } from "react"
import { Loader2, Network, Link2, GitBranch } from "lucide-react"
import { fetchCrossGraph, type CrossGraphAPI } from "@/lib/api"

// Per-course accent colors (cycled, same family as the mind-map palette).
const COURSE_COLORS = ["#5BE39A", "#6FB6F0", "#C9A0F0", "#F0C27C", "#E89BC0", "#8FE0D6"]

// Pretty-label cache for normalized bridge keys (purely cosmetic).
const displayLabel = new Map<string, string>()

/**
 * Cross-course prerequisite graph (Sprint 4). Renders the combined topic set
 * grouped by course plus the inferred "shared concept" bridges that connect
 * courses, and a count of prerequisite links within each course.
 */
export function CrossCourseView() {
  const [graph, setGraph] = useState<CrossGraphAPI | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    fetchCrossGraph()
      .then((g) => alive && setGraph(g))
      .catch((e) => alive && setError(e instanceof Error ? e.message : "No se pudo cargar el grafo."))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [])

  const colorOf = useMemo(() => {
    const map = new Map<string, string>()
    graph?.courses.forEach((c, i) => map.set(c.syllabus_id, COURSE_COLORS[i % COURSE_COLORS.length]))
    return map
  }, [graph])

  // Group nodes by course; count intra-course prereq edges per course.
  const grouped = useMemo(() => {
    if (!graph) return []
    const byCourse = new Map<string, CrossGraphAPI["nodes"]>()
    for (const n of graph.nodes) {
      const arr = byCourse.get(n.syllabus_id) ?? []
      arr.push(n)
      byCourse.set(n.syllabus_id, arr)
    }
    const nodeCourse = new Map(graph.nodes.map((n) => [n.id, n.syllabus_id]))
    const prereqCount = new Map<string, number>()
    for (const e of graph.edges) {
      if (e.kind !== "prerequisite") continue
      const sid = nodeCourse.get(e.source)
      if (sid) prereqCount.set(sid, (prereqCount.get(sid) ?? 0) + 1)
    }
    return graph.courses.map((c) => ({
      ...c,
      topics: (byCourse.get(c.syllabus_id) ?? []).slice().sort((a, b) => b.weight_percent - a.weight_percent),
      prereqs: prereqCount.get(c.syllabus_id) ?? 0,
    }))
  }, [graph])

  // Shared-concept bridges, de-duplicated by topic label → the courses it spans.
  const bridges = useMemo(() => {
    if (!graph) return []
    const labelOf = new Map(graph.nodes.map((n) => [n.id, n]))
    const byLabel = new Map<string, Set<string>>()
    for (const e of graph.edges) {
      if (e.kind !== "shared") continue
      const a = labelOf.get(e.source)
      const b = labelOf.get(e.target)
      if (!a || !b) continue
      const key = a.label.trim().toLowerCase()
      const set = byLabel.get(key) ?? new Set<string>()
      set.add(a.syllabus_id)
      set.add(b.syllabus_id)
      byLabel.set(key, set)
      // keep a display label
      if (!displayLabel.has(key)) displayLabel.set(key, a.label)
    }
    return [...byLabel.entries()].map(([key, sids]) => ({ label: displayLabel.get(key) ?? key, sids: [...sids] }))
  }, [graph])

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }
  if (error) {
    return <div className="rounded-2xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">{error}</div>
  }
  if (!graph || graph.nodes.length === 0) {
    return (
      <div className="flex h-64 flex-col items-center justify-center rounded-2xl border border-border bg-card text-center text-muted-foreground">
        <Network className="mb-3 h-10 w-10 opacity-20" />
        <p className="mb-1 text-sm font-medium">Aún no hay temas en tus cursos.</p>
        <p className="text-xs">Genera el mapa mental de cada curso para construir el grafo entre cursos.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {/* cross-course bridges */}
      <div className="rounded-2xl border border-border/70 bg-card/40 p-5">
        <div className="mb-3 flex items-center gap-2 text-sm font-extrabold text-foreground">
          <Link2 className="h-4 w-4 text-accent" /> Conexiones entre cursos
          <span className="ml-1 text-[11px] font-normal text-muted-foreground">
            conceptos compartidos que conectan tus materias
          </span>
        </div>
        {bridges.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            No se detectaron conceptos compartidos entre cursos todavía.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2.5">
            {bridges.map((b) => (
              <div key={b.label} className="flex items-center gap-2 rounded-xl border border-accent/25 bg-accent/5 px-3 py-2">
                <span className="text-[13px] font-bold text-foreground">{b.label}</span>
                <div className="flex items-center gap-1">
                  {b.sids.map((sid) => (
                    <span key={sid} className="h-2.5 w-2.5 rounded-sm" style={{ background: colorOf.get(sid) ?? "#888" }} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* per-course topic columns */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {grouped.map((c) => {
          const color = colorOf.get(c.syllabus_id) ?? "#888"
          return (
            <div key={c.syllabus_id} className="flex flex-col rounded-2xl border border-border bg-card p-4">
              <div className="mb-3 flex items-center gap-2">
                <span className="h-3 w-3 flex-none rounded-sm" style={{ background: color }} />
                <span className="flex-1 truncate text-sm font-bold text-foreground" title={c.course}>
                  {c.course}
                </span>
                <span className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground" title="prerrequisitos en este curso">
                  <GitBranch className="h-3 w-3" />
                  {c.prereqs}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {c.topics.map((t) => (
                  <span
                    key={t.id}
                    className="rounded-lg border border-border bg-secondary/40 px-2.5 py-1 text-[12px] font-medium text-muted-foreground"
                    title={t.weight_percent > 0 ? `${Math.round(t.weight_percent)}% del examen` : undefined}
                  >
                    {t.label}
                    {t.weight_percent > 0 && (
                      <span className="ml-1.5 font-mono text-[10px] text-accent">{Math.round(t.weight_percent)}%</span>
                    )}
                  </span>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
