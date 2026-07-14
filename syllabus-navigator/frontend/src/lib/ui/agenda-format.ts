/**
 * agenda-format.ts — pure formatting helpers for the Agenda window (UI-6).
 * Extracted so the date/label logic is unit-testable apart from React.
 */
import {
  CalendarDays,
  FileText,
  BookOpen,
  GraduationCap,
  ClipboardList,
  type LucideIcon,
} from "lucide-react"
import type { DatePrecisionAPI } from "@/lib/api"
import { MONTHS_SHORT } from "./agenda-weeks"

export interface TypeMeta {
  label: string
  /** Badge variant for this event type (see components/ui/badge.tsx). */
  variant: "ok" | "error" | "warn" | "accent" | "default"
  Icon: LucideIcon
}

export const TYPE_META: Record<string, TypeMeta> = {
  quiz: { label: "Quiz", variant: "warn", Icon: ClipboardList },
  exam: { label: "Examen", variant: "error", Icon: GraduationCap },
  assignment: { label: "Tarea", variant: "accent", Icon: FileText },
  project: { label: "Proyecto", variant: "accent", Icon: FileText },
  class: { label: "Tema", variant: "ok", Icon: BookOpen },
  reading: { label: "Lectura", variant: "ok", Icon: BookOpen },
  other: { label: "Evento", variant: "default", Icon: CalendarDays },
}

export function meta(type: string): TypeMeta {
  return TYPE_META[type] ?? TYPE_META.other
}

/** "7 jul" for an ISO date. Empty string on malformed input. */
export function dayMonthLabel(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return ""
  return `${+m[3]} ${MONTHS_SHORT[+m[2] - 1]}`
}

interface DatedEvent {
  event_date: string | null
  week_label: string | null
  date_precision?: DatePrecisionAPI
}

/**
 * What the row shows in its date column. A `week`-precision event only knows
 * its week, so it says so ("Semana 5 · sem. 7 jul") instead of pretending the
 * Monday it was resolved to is the real day.
 */
export function whenLabel(e: DatedEvent): string {
  if (e.date_precision === "week" && e.event_date) {
    const week = dayMonthLabel(e.event_date)
    return e.week_label ? `${e.week_label} · sem. ${week}` : `Semana del ${week}`
  }
  return e.event_date ?? e.week_label ?? "Sin fecha"
}

/**
 * "Hoy" / "En 3 días". Null for `week`-precision events: their date is the
 * Monday of the week, so a day count would be fiction.
 */
export function daysBadge(d: number | null, precision?: DatePrecisionAPI): string | null {
  if (d == null || precision === "week" || precision === "none") return null
  if (d < 0) return "Vencido"
  if (d === 0) return "Hoy"
  if (d === 1) return "Mañana"
  return `En ${d} días`
}
