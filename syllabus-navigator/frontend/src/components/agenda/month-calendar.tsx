"use client"

import { useMemo, useState, type ReactNode } from "react"
import { ChevronLeft, ChevronRight, FileText, StickyNote } from "lucide-react"
import type { ScheduleEventAPI } from "@/lib/api"

const PALETTE = ["bg-accent", "bg-blue-400", "bg-purple-400", "bg-amber-400", "bg-pink-400"]
const DOT_HEX = ["#3FBF84", "#60a5fa", "#c084fc", "#fbbf24", "#f472b6"]
const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]
const MONTHS = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
]

/** Stable color index for a course name (so the same course keeps its color). */
export function courseColorIndex(name: string): number {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return h % PALETTE.length
}

/** Group dated events by ISO yyyy-mm-dd. Undated events are excluded. Pure → testable. */
export function bucketEventsByDate(events: ScheduleEventAPI[]): Record<string, ScheduleEventAPI[]> {
  const out: Record<string, ScheduleEventAPI[]> = {}
  for (const e of events) {
    if (!e.event_date || !/^\d{4}-\d{2}-\d{2}$/.test(e.event_date)) continue
    ;(out[e.event_date] ??= []).push(e)
  }
  return out
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

/** Monday-indexed weekday (0 = Mon … 6 = Sun) for a y/m/d. */
function mondayIndex(year: number, monthZero: number, day: number): number {
  const js = new Date(year, monthZero, day).getDay() // 0 = Sun
  return (js + 6) % 7
}

interface Props {
  events: ScheduleEventAPI[]
  today: string // ISO yyyy-mm-dd
  /** Open the day panel (notes + events) for an ISO yyyy-mm-dd. */
  onSelectDay?: (iso: string) => void
  /** ISO yyyy-mm-dd currently expanded (for highlight). */
  selectedDate?: string | null
  /** Days (yyyy-mm-dd) that have at least one note → show a marker. */
  noteDates?: Set<string>
  /** Inline expansion rendered inside the calendar card, right under the grid. */
  dayPanel?: ReactNode
}

export function MonthCalendar({
  events,
  today,
  onSelectDay,
  selectedDate,
  noteDates,
  dayPanel,
}: Props) {
  // Parse "today" as the anchor; default to the first dated event's month if today unparseable.
  const anchor = useMemo(() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today)
    if (m) return { year: +m[1], month: +m[2] - 1, day: +m[3] }
    return { year: 2026, month: 5, day: 1 }
  }, [today])

  const [offset, setOffset] = useState(0) // months from the anchor month

  const view = useMemo(() => {
    const base = new Date(anchor.year, anchor.month + offset, 1)
    return { year: base.getFullYear(), month: base.getMonth() }
  }, [anchor, offset])

  const buckets = useMemo(() => bucketEventsByDate(events), [events])
  const colorFor = (name: string) => courseColorIndex(name)

  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate()
  const lead = mondayIndex(view.year, view.month, 1)

  // Build a flat cell array (leading blanks + days), chunk into weeks of 7.
  const cells: ({ day: number; iso: string } | null)[] = []
  for (let i = 0; i < lead; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, iso: `${view.year}-${pad(view.month + 1)}-${pad(d)}` })
  }
  while (cells.length % 7 !== 0) cells.push(null)
  const weeks: (typeof cells)[] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))

  const todayIso = `${anchor.year}-${pad(anchor.month + 1)}-${pad(anchor.day)}`

  // Sorted detected-dates list (this view's events + all dated events).
  const detected = events
    .filter((e) => e.event_date && /^\d{4}-\d{2}-\d{2}$/.test(e.event_date))
    .sort((a, b) => (a.event_date! < b.event_date! ? -1 : 1))

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border/60 bg-card p-5">
        <div className="mb-4 flex items-center justify-between">
          <div className="text-base font-bold">
            {MONTHS[view.month]} {view.year}
          </div>
          <div className="flex gap-1.5">
            <button
              onClick={() => setOffset((o) => o - 1)}
              aria-label="Mes anterior"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-secondary"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={() => setOffset((o) => o + 1)}
              aria-label="Mes siguiente"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-secondary"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="mb-1.5 grid grid-cols-7 gap-1.5">
          {WEEKDAYS.map((w) => (
            <div
              key={w}
              className="pb-0.5 text-center text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground"
            >
              {w}
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-1.5">
          {weeks.map((week, wi) => (
            <div key={wi} className="grid grid-cols-7 gap-1.5">
              {week.map((cell, ci) => {
                if (!cell) return <div key={ci} />
                const evs = buckets[cell.iso] ?? []
                const isToday = cell.iso === todayIso
                const isSelected = cell.iso === selectedDate
                const hasNote = noteDates?.has(cell.iso) ?? false
                return (
                  <button
                    key={ci}
                    type="button"
                    onClick={() => onSelectDay?.(cell.iso)}
                    aria-label={`Abrir ${cell.iso}`}
                    aria-pressed={isSelected}
                    className={`flex min-h-[78px] flex-col gap-1 rounded-xl border p-1.5 text-left transition-colors hover:border-accent/40 hover:bg-accent/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
                      isSelected
                        ? "border-accent bg-accent/10 ring-1 ring-accent/40"
                        : isToday
                          ? "border-accent/45 bg-accent/5"
                          : "border-border/50 bg-secondary/20"
                    }`}
                  >
                    <div className="flex w-full items-center justify-between">
                      <span
                        className={`flex h-5 w-5 items-center justify-center rounded-md font-mono text-[11px] font-semibold ${
                          isToday ? "bg-accent text-accent-foreground" : "text-muted-foreground"
                        }`}
                      >
                        {cell.day}
                      </span>
                      {hasNote && (
                        <StickyNote className="h-3 w-3 text-accent" aria-label="Tiene notas" />
                      )}
                    </div>
                    {evs.slice(0, 3).map((e) => (
                      <div
                        key={e.id}
                        className="flex w-full items-center gap-1 overflow-hidden rounded-md bg-card px-1 py-0.5"
                      >
                        <span
                          className={`h-1.5 w-1.5 flex-none rounded-full ${PALETTE[colorFor(e.course_name)]}`}
                        />
                        <span className="min-w-0 flex-1 truncate text-[9.5px] font-medium text-foreground">
                          {e.title}
                        </span>
                      </div>
                    ))}
                  </button>
                )
              })}
            </div>
          ))}
        </div>

        {/* Inline day expansion (notes + events), in-card under the grid. */}
        {dayPanel}
      </div>

      {detected.length > 0 && (
        <div>
          <div className="mb-2.5 text-[11px] font-bold uppercase tracking-widest text-accent">
            Fechas detectadas en los cronogramas
          </div>
          <ul className="flex flex-col gap-2">
            {detected.map((e) => (
              <li
                key={e.id}
                className="flex items-center gap-3.5 rounded-xl border border-border/50 bg-card px-4 py-3"
              >
                <span className="font-mono text-[13px] font-semibold text-foreground">
                  {e.event_date}
                </span>
                <span
                  className="h-8 w-0.5 flex-none rounded"
                  style={{ background: DOT_HEX[colorFor(e.course_name)] }}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-foreground">{e.title}</div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                    <FileText className="h-3 w-3" />
                    <span className="truncate">{e.course_name}</span>
                  </div>
                </div>
                {e.weight_percent ? (
                  <span className="flex-none font-mono text-[11px] text-muted-foreground">
                    {e.weight_percent}%
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
