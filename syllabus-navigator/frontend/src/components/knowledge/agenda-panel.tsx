"use client"

import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import {
  fetchAgenda,
  fetchRecommendations,
  listNoteDates,
  listRecentNotes,
  createNote,
  deleteNote,
  type ScheduleEventAPI,
  type WeeklyPlanAPI,
  type DateNoteAPI,
} from "@/lib/api"
import { useUser } from "@/context/UserContext"
import { MonthCalendar, bucketEventsByDate } from "@/components/agenda/month-calendar"
import { DayNotesPanel } from "@/components/agenda/day-notes-panel"
import { weekRangeLabel } from "@/lib/ui/agenda-weeks"
import { dayMonthLabel } from "@/lib/ui/agenda-format"
import { prepareQuickNote, QUICK_NOTE_COLORS } from "@/lib/ui/quick-note"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  CalendarDays,
  Loader2,
  StickyNote,
  Pencil,
  Plus,
  Trash2,
  AlertCircle,
} from "lucide-react"

/** Relative "hace X" label from a timestamp, in the agenda's Spanish voice. */
function agoLabel(ts: string): string {
  const ms = Date.now() - new Date(ts).getTime()
  const m = Math.floor(ms / 60_000)
  if (m < 1) return "Ahora"
  if (m < 60) return `hace ${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.floor(h / 24)
  if (d === 1) return "hace 1 día"
  if (d < 7) return `hace ${d} días`
  const w = Math.floor(d / 7)
  return w === 1 ? "hace 1 semana" : `hace ${w} semanas`
}

/** Split a quick note into a bold first line + muted rest (display only). */
function splitNote(body: string): { title: string; rest: string } {
  const nl = body.indexOf("\n")
  if (nl > 0) return { title: body.slice(0, nl).trim(), rest: body.slice(nl + 1).trim() }
  const sep = /^(.{3,60}?)[:—]\s+(.+)$/.exec(body)
  if (sep) return { title: sep[1].trim(), rest: sep[2].trim() }
  return { title: body, rest: "" }
}

/**
 * Right-hand Agenda column of the unified Knowledge page: month calendar with
 * the inline day panel, and a quick-notes panel (recent notes across all days
 * + a composer that saves on today).
 */
export function AgendaPanel() {
  const { status, ready } = useUser()
  const canEditNotes = status !== "anonymous" && status !== "guest"

  const [plan, setPlan] = useState<WeeklyPlanAPI | null>(null)
  const [events, setEvents] = useState<ScheduleEventAPI[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [noteDates, setNoteDates] = useState<Set<string>>(new Set())

  // Quick notes (recent across all dates)
  const [recentNotes, setRecentNotes] = useState<DateNoteAPI[]>([])
  const [notesLoading, setNotesLoading] = useState(true)
  const [draft, setDraft] = useState("")
  const [savingNote, setSavingNote] = useState(false)
  const composerRef = useRef<HTMLInputElement>(null)

  const refreshRecent = () => {
    if (!canEditNotes) {
      setNotesLoading(false)
      return
    }
    listRecentNotes(5)
      .then((d) => setRecentNotes(d.notes))
      .catch(() => {})
      .finally(() => setNotesLoading(false))
  }

  useEffect(() => {
    if (!ready) return
    if (status === "anonymous") {
      setLoading(false)
      setNotesLoading(false)
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
    if (canEditNotes) {
      listNoteDates()
        .then((d) => alive && setNoteDates(new Set(d.dates)))
        .catch(() => {})
      listRecentNotes(5)
        .then((d) => alive && setRecentNotes(d.notes))
        .catch(() => {})
        .finally(() => alive && setNotesLoading(false))
    } else {
      setNotesLoading(false)
    }
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, status, canEditNotes])

  const handleNoteCountChange = (date: string, hasNotes: boolean) => {
    setNoteDates((prev) => {
      const next = new Set(prev)
      if (hasNotes) next.add(date)
      else next.delete(date)
      return next
    })
    refreshRecent()
  }

  const todayIso =
    plan?.today ??
    (() => {
      const d = new Date()
      const p = (n: number) => (n < 10 ? `0${n}` : `${n}`)
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
    })()

  const handleAddQuickNote = async () => {
    if (!draft.trim() || !canEditNotes) return
    const prepared = prepareQuickNote(
      draft,
      QUICK_NOTE_COLORS[recentNotes.length % QUICK_NOTE_COLORS.length],
    )
    setSavingNote(true)
    try {
      const { note } = await createNote(todayIso, prepared.body, {
        title: prepared.title,
        color: prepared.color,
      })
      setRecentNotes((prev) => [note, ...prev].slice(0, 5))
      setNoteDates((prev) => new Set(prev).add(todayIso))
      setDraft("")
    } catch {
      toast.error("No se pudo guardar la nota.")
    } finally {
      setSavingNote(false)
    }
  }

  const handleDeleteQuickNote = async (id: string) => {
    const prev = recentNotes
    setRecentNotes((n) => n.filter((x) => x.id !== id))
    try {
      await deleteNote(id)
      refreshRecent()
      listNoteDates()
        .then((d) => setNoteDates(new Set(d.dates)))
        .catch(() => {})
    } catch {
      toast.error("No se pudo borrar la nota.")
      setRecentNotes(prev)
    }
  }

  const dayBuckets = bucketEventsByDate(events)

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <CalendarDays className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
          Agenda
        </h2>
        {plan && (
          <span className="truncate text-xs text-muted-foreground/70">
            · Hoy {dayMonthLabel(plan.today)} · Semana {weekRangeLabel(plan.week_start)}
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center rounded-2xl border border-border/50 bg-card">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="flex h-40 flex-col items-center justify-center rounded-2xl border border-border/50 bg-card text-center text-destructive">
          <AlertCircle className="mb-2 h-7 w-7" />
          <p className="text-sm">{error}</p>
        </div>
      ) : (
        <>
          <MonthCalendar
            showDetectedList={false}
            events={events}
            today={todayIso}
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

          {/* ─── Notas rápidas ─── */}
          <section className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-card p-4">
            <div className="flex items-center gap-2">
              <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
              <h3 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                Notas
              </h3>
              <div className="flex-1" />
              {canEditNotes && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5 rounded-full text-xs"
                  onClick={() => composerRef.current?.focus()}
                >
                  <Plus className="h-3 w-3" /> Nueva nota
                </Button>
              )}
            </div>

            {!canEditNotes ? (
              <p className="rounded-lg border border-dashed border-border/60 px-3 py-4 text-center text-xs text-muted-foreground">
                Inicia sesión con una cuenta para escribir notas.
              </p>
            ) : notesLoading ? (
              <div className="flex h-16 items-center justify-center">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                {recentNotes.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border/60 px-3 py-4 text-center text-xs text-muted-foreground">
                    Sin notas. Escribe una abajo.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {recentNotes.map((n, i) => {
                      const fallback = splitNote(n.body)
                      const title = n.title?.trim() || fallback.title
                      const rest = n.title?.trim() ? n.body : fallback.rest
                      return (
                        <li
                          key={n.id}
                          className="group flex items-start gap-2.5 rounded-lg border border-border/50 bg-secondary/20 px-3 py-2"
                        >
                          <span
                            className="mt-1.5 h-2 w-2 flex-none rounded-full"
                            style={{
                              background: n.color ?? QUICK_NOTE_COLORS[i % QUICK_NOTE_COLORS.length],
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => setSelectedDate(n.note_date)}
                            className="min-w-0 flex-1 text-left"
                            title={`Ver el día ${n.note_date}`}
                          >
                            <span className="block truncate text-xs font-semibold text-foreground">
                              {title}
                            </span>
                            {rest && (
                              <span className="block truncate text-[11px] text-muted-foreground">
                                {rest}
                              </span>
                            )}
                          </button>
                          <span className="flex-none pt-0.5 text-[10px] font-medium text-muted-foreground">
                            {agoLabel(n.created_at)}
                          </span>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            onClick={() => handleDeleteQuickNote(n.id)}
                            title="Eliminar nota"
                            className="h-6 w-6 flex-none opacity-0 transition-opacity group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </li>
                      )
                    })}
                  </ul>
                )}

                <div className="flex items-center gap-2">
                  <StickyNote className="h-3.5 w-3.5 flex-none text-muted-foreground/60" />
                  <Input
                    ref={composerRef}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAddQuickNote()}
                    placeholder="Escribe una nota rápida y pulsa Enter…"
                    className="h-8 flex-1 text-xs"
                  />
                  <Button
                    size="sm"
                    variant="accent"
                    className="h-8"
                    onClick={handleAddQuickNote}
                    disabled={savingNote || !draft.trim()}
                  >
                    {savingNote ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Guardar"}
                  </Button>
                </div>
              </>
            )}
          </section>
        </>
      )}
    </div>
  )
}
