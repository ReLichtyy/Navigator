"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Network, Orbit, Route } from "lucide-react"
import {
  fetchCrossGraph,
  fetchRecommendations,
  type CrossGraphAPI,
  type UpcomingAssessmentAPI,
} from "@/lib/api"
import { CrossGalaxy } from "./cross-galaxy"
import { CrossRoadmap } from "./cross-roadmap"

// Per-course accent colors (cycled, same family as the mind-map palette).
const COURSE_COLORS = ["#5BE39A", "#6FB6F0", "#C9A0F0", "#F0C27C", "#E89BC0", "#8FE0D6"]

type CrossView = "galaxy" | "route"

/**
 * Cross-course explorer. Two lenses over the combined topic graph:
 * - Galaxy: visual cluster map (courses + shared-concept bridges + prereqs).
 * - Route: a suggested study order across courses (by exam proximity + prereqs).
 */
export function CrossCourseView() {
  const router = useRouter()
  const [graph, setGraph] = useState<CrossGraphAPI | null>(null)
  const [assessments, setAssessments] = useState<UpcomingAssessmentAPI[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<CrossView>("galaxy")

  useEffect(() => {
    let alive = true
    setLoading(true)
    Promise.all([fetchCrossGraph(), fetchRecommendations().catch(() => null)])
      .then(([g, plan]) => {
        if (!alive) return
        setGraph(g)
        setAssessments(plan?.upcoming_assessments ?? [])
      })
      .catch(
        (e) => alive && setError(e instanceof Error ? e.message : "No se pudo cargar el grafo."),
      )
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [])

  const colorOf = useMemo(() => {
    const map = new Map<string, string>()
    graph?.courses.forEach((c, i) =>
      map.set(c.syllabus_id, COURSE_COLORS[i % COURSE_COLORS.length]),
    )
    return map
  }, [graph])

  const openCourse = (syllabusId: string) => router.push(`/mapa?course=${syllabusId}`)

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }
  if (error) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
        {error}
      </div>
    )
  }
  if (!graph || graph.nodes.length === 0) {
    return (
      <div className="flex h-64 flex-col items-center justify-center rounded-2xl border border-border bg-card text-center text-muted-foreground">
        <Network className="mb-3 h-10 w-10 opacity-20" />
        <p className="mb-1 text-sm font-medium">Aún no hay temas en tus cursos.</p>
        <p className="text-xs">
          Genera el mapa mental de cada curso para construir el grafo entre cursos.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* inner lens toggle */}
      <div className="inline-flex gap-1 self-start rounded-xl border border-border bg-card/50 p-1">
        <LensTab
          active={view === "galaxy"}
          onClick={() => setView("galaxy")}
          icon={<Orbit className="h-3.5 w-3.5" />}
          label="Galaxia"
        />
        <LensTab
          active={view === "route"}
          onClick={() => setView("route")}
          icon={<Route className="h-3.5 w-3.5" />}
          label="Ruta de aprendizaje"
        />
      </div>

      {view === "galaxy" ? (
        <CrossGalaxy graph={graph} colorOf={colorOf} onPickCourse={openCourse} />
      ) : (
        <CrossRoadmap
          graph={graph}
          colorOf={colorOf}
          assessments={assessments}
          onPickCourse={openCourse}
        />
      )}
    </div>
  )
}

function LensTab({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors ${
        active ? "bg-accent/15 text-accent" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {icon}
      {label}
    </button>
  )
}
