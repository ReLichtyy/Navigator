"use client"

import { useEffect, useState } from "react"
import { useUser } from "@/context/UserContext"
import { useAuthModal } from "@/context/AuthModalContext"
import {
  fetchAgenda,
  fetchRecommendations,
  type ScheduleEventAPI,
  type WeeklyPlanAPI,
} from "@/lib/api"
import {
  CalendarDays,
  Loader2,
  FileText,
  AlertCircle,
  BookOpen,
  GraduationCap,
  ClipboardList,
} from "lucide-react"
import { MonthCalendar } from "@/components/agenda/month-calendar"

const TYPE_META: Record<string, { label: string; cls: string; Icon: typeof FileText }> = {
  quiz: { label: "Quiz", cls: "bg-amber-500/10 text-amber-500", Icon: ClipboardList },
  exam: { label: "Examen", cls: "bg-red-500/10 text-red-500", Icon: GraduationCap },
  assignment: { label: "Tarea", cls: "bg-blue-500/10 text-blue-500", Icon: FileText },
  project: { label: "Proyecto", cls: "bg-purple-500/10 text-purple-500", Icon: FileText },
  class: { label: "Tema", cls: "bg-green-500/10 text-green-500", Icon: BookOpen },
  reading: { label: "Lectura", cls: "bg-teal-500/10 text-teal-500", Icon: BookOpen },
  other: { label: "Evento", cls: "bg-secondary text-muted-foreground", Icon: CalendarDays },
}

function meta(type: string) {
  return TYPE_META[type] ?? TYPE_META.other
}

function whenLabel(e: { event_date: string | null; week_label: string | null }) {
  return e.event_date ?? e.week_label ?? "Sin fecha"
}

function daysBadge(d: number | null): string | null {
  if (d == null) return null
  if (d < 0) return "Vencido"
  if (d === 0) return "Hoy"
  if (d === 1) return "Mañana"
  return `En ${d} días`
}

export default function AgendaPage() {
  const { status, ready } = useUser()
  const { openAuthModal } = useAuthModal()

  const [plan, setPlan] = useState<WeeklyPlanAPI | null>(null)
  const [events, setEvents] = useState<ScheduleEventAPI[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!ready) return
    if (status === "anonymous") {
      setLoading(false)
      return
    }
    let alive = true
    Promise.all([fetchRecommendations(), fetchAgenda()])
      .then(([p, a]) => {
        if (!alive) return
        setPlan(p)
        setEvents(a.events)
      })
      .catch(() => alive && setError("No se pudo cargar la agenda."))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [ready, status])

  if (ready && status === "anonymous") {
    return (
      <main className="flex h-dvh w-full items-center justify-center bg-background text-foreground">
        <div className="flex max-w-md flex-col items-center text-center p-8 border border-border/60 rounded-xl bg-card shadow-sm">
          <CalendarDays className="h-12 w-12 text-accent mb-4" />
          <h2 className="text-xl font-semibold mb-2">Agenda</h2>
          <p className="text-sm text-muted-foreground mb-6">
            Inicia sesión para ver tus quizes, exámenes y temas de la semana extraídos de tus cursos.
          </p>
          <button
            onClick={() => openAuthModal("signup")}
            className="rounded-full bg-accent px-6 py-2.5 text-sm font-medium text-accent-foreground hover:bg-accent/90 transition-colors"
          >
            Crear cuenta
          </button>
        </div>
      </main>
    )
  }

  // Group full agenda by course.
  const byCourse = events.reduce<Record<string, ScheduleEventAPI[]>>((acc, e) => {
    ;(acc[e.course_name] ??= []).push(e)
    return acc
  }, {})

  return (
    <main className="flex h-dvh w-full flex-col bg-background text-foreground overflow-hidden">
      <header className="flex h-14 items-center gap-2 border-b border-border/60 px-6 shrink-0">
        <CalendarDays className="h-5 w-5 text-accent" />
        <h1 className="text-lg font-semibold">Agenda</h1>
        {plan && <span className="text-xs text-muted-foreground ml-2">Hoy: {plan.today}</span>}
      </header>

      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-4xl space-y-8">
          {loading ? (
            <div className="flex h-64 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="flex h-40 flex-col items-center justify-center text-center text-red-500">
              <AlertCircle className="h-8 w-8 mb-2" />
              <p>{error}</p>
            </div>
          ) : events.length === 0 ? (
            <div className="flex h-64 flex-col items-center justify-center text-center text-muted-foreground">
              <CalendarDays className="h-10 w-10 mb-3 opacity-20" />
              <p className="text-sm font-medium mb-1">Aún no hay agenda.</p>
              <p className="text-xs">
                Sube un sílabo con cronograma en la Knowledge Base y se extraerá automáticamente.
              </p>
            </div>
          ) : (
            <>
              {/* ─── This week / recommendations ─── */}
              {plan && (
                <section className="rounded-xl border border-accent/30 bg-accent/5 p-5">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-accent mb-4">
                    Esta semana ({plan.week_start} → {plan.week_end})
                  </h2>

                  {plan.upcoming_assessments.length > 0 && (
                    <div className="mb-5">
                      <p className="text-xs font-medium text-muted-foreground mb-2">Próximas evaluaciones</p>
                      <ul className="space-y-2">
                        {plan.upcoming_assessments.map((a) => {
                          const m = meta(a.event_type)
                          const badge = daysBadge(a.days_until)
                          return (
                            <li key={a.id} className="rounded-lg bg-card border border-border/60 p-3">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${m.cls}`}>
                                  <m.Icon className="h-3 w-3" />
                                  {m.label}
                                </span>
                                <span className="font-medium text-sm">{a.title}</span>
                                {a.weight_percent ? (
                                  <span className="text-xs text-muted-foreground">{a.weight_percent}%</span>
                                ) : null}
                                <span className="ml-auto text-xs text-muted-foreground">
                                  {whenLabel(a)}
                                  {badge && <span className="ml-2 text-accent font-medium">· {badge}</span>}
                                </span>
                              </div>
                              <p className="text-[11px] text-muted-foreground mt-1">{a.course_name}</p>
                              {a.review_first.length > 0 && (
                                <p className="text-xs mt-2">
                                  <span className="text-muted-foreground">Repasa primero: </span>
                                  <span className="text-foreground">{a.review_first.join(", ")}</span>
                                </p>
                              )}
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  )}

                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-2">Temas de la semana</p>
                    {plan.this_week_topics.length > 0 ? (
                      <ul className="flex flex-wrap gap-2">
                        {plan.this_week_topics.map((t) => (
                          <li key={t.id} className="rounded-full bg-green-500/10 text-green-600 px-3 py-1 text-xs">
                            {t.title}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        No hay temas con fecha esta semana. Revisa la agenda completa abajo.
                      </p>
                    )}
                  </div>
                </section>
              )}

              {/* ─── Month calendar (dated events) ─── */}
              <MonthCalendar events={events} today={plan?.today ?? "2026-06-22"} />

              {/* ─── Full agenda by course ─── */}
              {Object.entries(byCourse).map(([course, evs]) => (
                <section key={course}>
                  <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                    <FileText className="h-4 w-4 text-accent/70" />
                    {course}
                  </h3>
                  <ul className="space-y-1.5">
                    {evs.map((e) => {
                      const m = meta(e.event_type)
                      return (
                        <li
                          key={e.id}
                          className="flex items-center gap-3 rounded-lg border border-border/50 bg-card px-3 py-2 text-sm"
                        >
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium shrink-0 ${m.cls}`}>
                            <m.Icon className="h-3 w-3" />
                            {m.label}
                          </span>
                          <span className="flex-1 truncate">{e.title}</span>
                          {e.weight_percent ? (
                            <span className="text-xs text-muted-foreground shrink-0">{e.weight_percent}%</span>
                          ) : null}
                          <span className="text-xs text-muted-foreground shrink-0 w-28 text-right">
                            {whenLabel(e)}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              ))}
            </>
          )}
        </div>
      </div>
    </main>
  )
}
