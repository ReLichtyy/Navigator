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

export function whenLabel(e: { event_date: string | null; week_label: string | null }): string {
  return e.event_date ?? e.week_label ?? "Sin fecha"
}

export function daysBadge(d: number | null): string | null {
  if (d == null) return null
  if (d < 0) return "Vencido"
  if (d === 0) return "Hoy"
  if (d === 1) return "Mañana"
  return `En ${d} días`
}
