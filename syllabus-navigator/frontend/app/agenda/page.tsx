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
import { CalendarDays, Loader2, FileText, AlertCircle, CheckCircle2 } from "lucide-react"
import Link from "next/link"
import { MonthCalendar, bucketEventsByDate } from "@/components/agenda/month-calendar"
import { DayNotesSheet } from "@/components/agenda/day-notes-sheet"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { meta, whenLabel, daysBadge } from "@/lib/ui/agenda-format"

export default function AgendaPage() {
  const { status, ready } = useUser()
  const { openAuthModal } = useAuthModal()

  const [plan, setPlan] = useState<WeeklyPlanAPI | null>(null)
  const [events, setEvents] = useState<ScheduleEventAPI[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)

  // Only registered users may keep notes (date_notes FKs users.id).
  const canEditNotes = status !== "anonymous" && status !== "guest"

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
          <Button variant="accent" size="pill" onClick={() => openAuthModal("signup")}>
            Crear cuenta
          </Button>
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
            <div className="flex h-40 flex-col items-center justify-center text-center text-destructive">
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
              {/* ─── Sync banner ─── */}
              <Card className="flex-row items-center gap-3 border-accent/25 bg-accent/5 p-4">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-accent" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-foreground">
                    Calendario sincronizado con tus cronogramas
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Las fechas importantes se extraen automáticamente de los PDFs de cada curso.
                  </div>
                </div>
                <Badge variant="accent" className="shrink-0">
                  {events.length} fechas detectadas
                </Badge>
              </Card>

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
                                <Badge variant={m.variant}>
                                  <m.Icon className="h-3 w-3" />
                                  {m.label}
                                </Badge>
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
                          <li key={t.id}>
                            <Badge variant="ok">{t.title}</Badge>
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
              <MonthCalendar events={events} today={plan?.today ?? "2026-06-22"} onSelectDay={setSelectedDate} />

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
                          <Badge variant={m.variant} className="shrink-0">
                            <m.Icon className="h-3 w-3" />
                            {m.label}
                          </Badge>
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

              {/* ─── Simulacro CTA for the next assessment ─── */}
              {(() => {
                const next = plan?.upcoming_assessments[0]
                if (!next) return null
                const syllabusId = events.find((e) => e.course_name === next.course_name)?.syllabus_id
                if (!syllabusId) return null
                return (
                  <Card className="flex-row items-center justify-between gap-4 border-accent/30 bg-accent/5 p-5">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-foreground">¿Listo para {next.title}?</div>
                      <div className="text-xs text-muted-foreground">
                        Genera un simulacro con el material de {next.course_name}.
                      </div>
                    </div>
                    <Button asChild variant="accent" size="pill" className="shrink-0">
                      <Link href={`/estudio?course=${syllabusId}&mode=simulacro`}>Iniciar simulacro</Link>
                    </Button>
                  </Card>
                )
              })()}
            </>
          )}
        </div>
      </div>

      <DayNotesSheet
        date={selectedDate}
        dayEvents={selectedDate ? bucketEventsByDate(events)[selectedDate] ?? [] : []}
        canEdit={canEditNotes}
        onClose={() => setSelectedDate(null)}
      />
    </main>
  )
}
