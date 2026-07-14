"use client"

import { useEffect, useState } from "react"
import { useUser } from "@/context/UserContext"
import { useAuthModal } from "@/context/AuthModalContext"
import {
  fetchAgenda,
  fetchRecommendations,
  listNoteDates,
  type ScheduleEventAPI,
  type WeeklyPlanAPI,
} from "@/lib/api"
import { CalendarDays, Loader2, FileText, AlertCircle } from "lucide-react"
import Link from "next/link"
import { MobileNav } from "@/components/navigator/mobile-nav"
import { MonthCalendar, bucketEventsByDate } from "@/components/agenda/month-calendar"
import { DayNotesPanel } from "@/components/agenda/day-notes-panel"
import { AgendaFilters } from "@/components/agenda/agenda-filters"
import {
  applyFilter,
  pruneFilter,
  courseKey,
  EMPTY_FILTER,
  type AgendaFilter,
} from "@/lib/ui/agenda-filter"
import {
  buildWeekGroups,
  defaultGroupKey,
  coursesMissingTermStart,
  isAssessment,
} from "@/lib/ui/agenda-weeks"
import { resolveCourseColor } from "@/lib/ui/course-color"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion"
import { meta, whenLabel, daysBadge } from "@/lib/ui/agenda-format"

export default function AgendaPage() {
  const { status, ready } = useUser()
  const { openAuthModal } = useAuthModal()

  const [plan, setPlan] = useState<WeeklyPlanAPI | null>(null)
  const [events, setEvents] = useState<ScheduleEventAPI[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [noteDates, setNoteDates] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState<AgendaFilter>(EMPTY_FILTER)

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
        // Drop selections for courses/docs that no longer exist.
        setFilter((f) => pruneFilter(f, a.events))
      })
      .catch(() => alive && setError("No se pudo cargar la agenda."))
      .finally(() => alive && setLoading(false))
    // Note markers (registered users only). Fail-silent.
    if (canEditNotes) {
      listNoteDates()
        .then((d) => alive && setNoteDates(new Set(d.dates)))
        .catch(() => {})
    }
    return () => {
      alive = false
    }
  }, [ready, status, canEditNotes])

  // Keep the calendar markers in sync when notes are added/removed for a day.
  const handleNoteCountChange = (date: string, hasNotes: boolean) =>
    setNoteDates((prev) => {
      const next = new Set(prev)
      if (hasNotes) next.add(date)
      else next.delete(date)
      return next
    })

  if (ready && status === "anonymous") {
    return (
      <main className="flex h-dvh w-full items-center justify-center bg-background text-foreground">
        <div className="flex max-w-md flex-col items-center text-center p-8 border border-border/60 rounded-xl bg-card shadow-sm">
          <CalendarDays className="h-12 w-12 text-accent mb-4" />
          <h2 className="text-xl font-semibold mb-2">Agenda</h2>
          <p className="text-sm text-muted-foreground mb-6">
            Inicia sesión para ver tus quizes, exámenes y temas de la semana extraídos de tus
            cursos.
          </p>
          <Button variant="accent" size="pill" onClick={() => openAuthModal("signup")}>
            Crear cuenta
          </Button>
        </div>
      </main>
    )
  }

  const todayIso = plan?.today ?? ""

  // Everything below the filter bar renders `visible` — the calendar, the week
  // accordion and the day panel all show the same filtered slice.
  const visible = applyFilter(events, filter)
  const dayBuckets = bucketEventsByDate(visible)
  const visibleCourses = new Set(visible.map(courseKey))

  // Próximos 5 días: assessments with a REAL date inside the next 5 days. An
  // event that only carries "Semana N" has no date until its course gets a
  // term_start — hence the hint below when this comes back empty.
  const next5 = (plan?.upcoming_assessments ?? []).filter(
    (a) =>
      a.days_until != null &&
      a.days_until >= 0 &&
      a.days_until <= 5 &&
      visibleCourses.has(a.course_id ?? `doc:${a.syllabus_id}`),
  )
  // Courses whose "Semana N" items can't be placed on the calendar yet.
  const needTermStart = coursesMissingTermStart(visible)

  // Weeks are Monday–Sunday and defined by the event's real date; undated
  // events group by their source document instead.
  const groups = buildWeekGroups(visible, todayIso)
  const defaultGroup = defaultGroupKey(groups)

  return (
    <main className="flex h-dvh w-full flex-col bg-background text-foreground overflow-hidden">
      <header className="flex h-14 items-center gap-2 border-b border-border/60 px-3 shrink-0 sm:px-6">
        <MobileNav />
        <CalendarDays className="hidden h-5 w-5 text-accent sm:inline" />
        <h1 className="text-lg font-semibold">Agenda</h1>
        {plan && (
          <span className="ml-2 truncate text-xs text-muted-foreground">Hoy: {plan.today}</span>
        )}
      </header>

      <div className="flex-1 overflow-auto p-4 sm:p-6">
        <div className="mx-auto max-w-5xl space-y-6">
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
                Sube el programa de tu curso (con su cronograma) en Cursos y se extraerá
                automáticamente.
              </p>
            </div>
          ) : (
            <>
              {/* ─── Filters over the dates extracted from the PDFs/cronogramas ─── */}
              <AgendaFilters
                events={events}
                value={filter}
                onChange={setFilter}
                shown={visible.length}
              />

              {/* ─── Month calendar HERO (calendar-first view) ─── */}
              <MonthCalendar
                large
                showDetectedList={false}
                events={visible}
                today={plan?.today ?? ""}
                onSelectDay={(iso) => setSelectedDate((cur) => (cur === iso ? null : iso))}
                selectedDate={selectedDate}
                noteDates={noteDates}
                dayPanel={
                  selectedDate ? (
                    <DayNotesPanel
                      date={selectedDate}
                      dayEvents={dayBuckets[selectedDate] ?? []}
                      canEdit={canEditNotes}
                      onClose={() => setSelectedDate(null)}
                      onCountChange={handleNoteCountChange}
                    />
                  ) : null
                }
              />

              {visible.length === 0 && (
                <p className="text-center text-xs text-muted-foreground">
                  Ningún evento coincide con los filtros activos.
                </p>
              )}

              {/* ─── Próximos 5 días (only what's actually near) ─── */}
              {plan && (
                <section className="rounded-xl border border-accent/30 bg-accent/5 p-5">
                  <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-accent">
                    Próximos 5 días
                  </h2>
                  {next5.length > 0 ? (
                    <ul className="space-y-2">
                      {next5.map((a) => {
                        const m = meta(a.event_type)
                        const badge = daysBadge(a.days_until)
                        // Assessments carry their course's color, so two exams of
                        // the same course read as the same course at a glance.
                        const color = resolveCourseColor(
                          a.course_color,
                          a.course_id ?? `doc:${a.syllabus_id}`,
                        )
                        return (
                          <li
                            key={a.id}
                            className="rounded-lg border border-l-4 border-border/60 bg-card p-3"
                            style={{ borderLeftColor: color }}
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant={m.variant}>
                                <m.Icon className="h-3 w-3" />
                                {m.label}
                              </Badge>
                              <span className="text-sm font-medium">{a.title}</span>
                              {a.weight_percent ? (
                                <span className="text-xs text-muted-foreground">
                                  {a.weight_percent}%
                                </span>
                              ) : null}
                              <span className="ml-auto text-xs text-muted-foreground">
                                {whenLabel(a)}
                                {badge && (
                                  <span className="ml-2 font-medium text-accent">· {badge}</span>
                                )}
                              </span>
                            </div>
                            <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                              <span
                                className="h-2 w-2 flex-none rounded-full"
                                style={{ background: color }}
                              />
                              {a.course_name}
                            </p>
                            {a.review_first.length > 0 && (
                              <p className="mt-2 text-xs">
                                <span className="text-muted-foreground">Repasa primero: </span>
                                <span className="text-foreground">{a.review_first.join(", ")}</span>
                              </p>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  ) : needTermStart.length > 0 ? (
                    // The schedule has "Semana N" items that carry no real date:
                    // without the course's term start they can never land here.
                    <div className="space-y-3">
                      <p className="text-xs text-muted-foreground">
                        No hay evaluaciones con fecha en los próximos 5 días.{" "}
                        {needTermStart.join(", ")}{" "}
                        {needTermStart.length === 1 ? "tiene eventos" : "tienen eventos"} en
                        &ldquo;Semana N&rdquo; sin fecha: fija el inicio del semestre y aparecerán
                        aquí y en el calendario.
                      </p>
                      <Button asChild variant="accent" size="sm">
                        <Link href="/knowledge">Fijar inicio del semestre</Link>
                      </Button>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Sin evaluaciones en los próximos 5 días. Revisa los temas por semana abajo.
                    </p>
                  )}
                </section>
              )}

              {/* ─── Temas y actividades por semana (real Mon–Sun weeks) ─── */}
              <section>
                <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                  <FileText className="h-4 w-4 text-accent/70" />
                  Temas y actividades por semana
                </h3>
                <Accordion
                  type="single"
                  collapsible
                  defaultValue={defaultGroup}
                  className="space-y-2"
                >
                  {groups.map((g) => (
                    <AccordionItem
                      key={g.key}
                      value={g.key}
                      className={g.isPast ? "opacity-60" : undefined}
                    >
                      <AccordionTrigger>
                        {g.kind === "doc" ? (
                          <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        ) : null}
                        <span className="flex-1 truncate">{g.label}</span>
                        {g.isCurrent && (
                          <Badge variant="accent" className="shrink-0">
                            Actual
                          </Badge>
                        )}
                        {g.kind === "doc" && (
                          <Badge variant="outline" className="shrink-0">
                            Sin fecha
                          </Badge>
                        )}
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {g.assessmentCount > 0 &&
                            `${g.assessmentCount} ${g.assessmentCount === 1 ? "evaluación" : "evaluaciones"}`}
                          {g.assessmentCount > 0 && g.topicCount > 0 && " · "}
                          {g.topicCount > 0 &&
                            `${g.topicCount} ${g.topicCount === 1 ? "tema" : "temas"}`}
                        </span>
                      </AccordionTrigger>
                      <AccordionContent className="space-y-1.5">
                        {g.items.map(({ event: e, count }) => {
                          const m = meta(e.event_type)
                          const assessment = isAssessment(e.event_type)
                          const color = resolveCourseColor(e.course_color, courseKey(e))
                          return (
                            <div
                              key={e.id}
                              className={`flex items-center gap-3 rounded-lg border bg-card px-3 py-2 text-sm ${
                                assessment ? "border-l-4 font-medium" : "border-border/50"
                              }`}
                              style={
                                assessment
                                  ? { borderLeftColor: color, borderColor: `${color}55` }
                                  : undefined
                              }
                            >
                              <Badge variant={m.variant} className="shrink-0">
                                <m.Icon className="h-3 w-3" />
                                {m.label}
                              </Badge>
                              <span className="flex-1 truncate">
                                {e.title}
                                {count > 1 && (
                                  <span className="ml-1.5 text-[11px] text-muted-foreground">
                                    ×{count}
                                  </span>
                                )}
                              </span>
                              <span className="hidden shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground sm:flex">
                                <span
                                  className="h-2 w-2 flex-none rounded-full"
                                  style={{ background: color }}
                                />
                                {e.course_name}
                              </span>
                              {e.weight_percent ? (
                                <span className="shrink-0 text-xs text-muted-foreground">
                                  {e.weight_percent}%
                                </span>
                              ) : null}
                              <span className="w-28 shrink-0 text-right text-xs text-muted-foreground">
                                {whenLabel(e)}
                              </span>
                            </div>
                          )
                        })}
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </section>

              {/* ─── Simulacro CTA for the next assessment ─── */}
              {(() => {
                const next = plan?.upcoming_assessments[0]
                if (!next) return null
                const syllabusId = next.syllabus_id
                if (!syllabusId) return null
                return (
                  <Card className="flex-col items-start justify-between gap-4 border-accent/30 bg-accent/5 p-5 sm:flex-row sm:items-center">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-foreground">
                        ¿Listo para {next.title}?
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Genera un simulacro con el material de {next.course_name}.
                      </div>
                    </div>
                    <Button asChild variant="accent" size="pill" className="shrink-0">
                      <Link href={`/estudio?course=${syllabusId}&mode=simulacro`}>
                        Iniciar simulacro
                      </Link>
                    </Button>
                  </Card>
                )
              })()}
            </>
          )}
        </div>
      </div>
    </main>
  )
}
