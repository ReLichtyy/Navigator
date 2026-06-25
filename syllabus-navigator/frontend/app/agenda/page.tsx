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

  // Próximos 5 días: only assessments within the next 5 days (auto-updates with `today`).
  const next5 = (plan?.upcoming_assessments ?? []).filter(
    (a) => a.days_until != null && a.days_until >= 0 && a.days_until <= 5,
  )

  // Group the full agenda by week_label (topics + activities), collapsed in an accordion.
  const NO_WEEK = "Sin semana fija"
  const weekNum = (s: string) => {
    const m = /(\d+)/.exec(s)
    return m ? +m[1] : Number.POSITIVE_INFINITY
  }
  const weekMap = new Map<string, ScheduleEventAPI[]>()
  for (const e of events) {
    const k = e.week_label?.trim() || NO_WEEK
    ;(weekMap.get(k) ?? weekMap.set(k, []).get(k)!).push(e)
  }
  const weeks = [...weekMap.entries()]
    .map(([key, evs]) => ({
      key,
      evs: [...evs].sort((a, b) => {
        if (a.event_date && b.event_date) return a.event_date < b.event_date ? -1 : 1
        if (a.event_date) return -1
        if (b.event_date) return 1
        return 0
      }),
    }))
    .sort((a, b) => {
      if (a.key === NO_WEEK) return 1
      if (b.key === NO_WEEK) return -1
      return weekNum(a.key) - weekNum(b.key)
    })

  // Default-open the week holding the next upcoming dated event (else the first week).
  const nextDated = events
    .filter(
      (e) => e.event_date && /^\d{4}-\d{2}-\d{2}$/.test(e.event_date) && e.event_date >= todayIso,
    )
    .sort((a, b) => (a.event_date! < b.event_date! ? -1 : 1))[0]
  const currentWeekKey = (nextDated?.week_label?.trim() || NO_WEEK) ?? weeks[0]?.key
  const defaultWeek = weeks.some((w) => w.key === currentWeekKey) ? currentWeekKey : weeks[0]?.key

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
              {/* ─── Month calendar HERO (calendar-first view) ─── */}
              <MonthCalendar
                large
                showDetectedList={false}
                events={events}
                today={plan?.today ?? ""}
                onSelectDay={(iso) => setSelectedDate((cur) => (cur === iso ? null : iso))}
                selectedDate={selectedDate}
                noteDates={noteDates}
                dayPanel={
                  selectedDate ? (
                    <DayNotesPanel
                      date={selectedDate}
                      dayEvents={bucketEventsByDate(events)[selectedDate] ?? []}
                      canEdit={canEditNotes}
                      onClose={() => setSelectedDate(null)}
                      onCountChange={handleNoteCountChange}
                    />
                  ) : null
                }
              />

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
                        return (
                          <li key={a.id} className="rounded-lg border border-border/60 bg-card p-3">
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
                            <p className="mt-1 text-[11px] text-muted-foreground">
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
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Sin evaluaciones en los próximos 5 días. Revisa los temas por semana abajo.
                    </p>
                  )}
                </section>
              )}

              {/* ─── Temas y actividades por semana (collapsed accordion) ─── */}
              <section>
                <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                  <FileText className="h-4 w-4 text-accent/70" />
                  Temas y actividades por semana
                </h3>
                <Accordion
                  type="single"
                  collapsible
                  defaultValue={defaultWeek}
                  className="space-y-2"
                >
                  {weeks.map((w) => (
                    <AccordionItem key={w.key} value={w.key}>
                      <AccordionTrigger>
                        <span className="flex-1">{w.key}</span>
                        {w.key === defaultWeek && (
                          <Badge variant="accent" className="shrink-0">
                            Actual
                          </Badge>
                        )}
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {w.evs.length} {w.evs.length === 1 ? "ítem" : "ítems"}
                        </span>
                      </AccordionTrigger>
                      <AccordionContent className="space-y-1.5">
                        {w.evs.map((e) => {
                          const m = meta(e.event_type)
                          return (
                            <div
                              key={e.id}
                              className="flex items-center gap-3 rounded-lg border border-border/50 bg-card px-3 py-2 text-sm"
                            >
                              <Badge variant={m.variant} className="shrink-0">
                                <m.Icon className="h-3 w-3" />
                                {m.label}
                              </Badge>
                              <span className="flex-1 truncate">{e.title}</span>
                              <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:inline">
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
                const syllabusId = events.find(
                  (e) => e.course_name === next.course_name,
                )?.syllabus_id
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
