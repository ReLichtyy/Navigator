/**
 * server/rag/schedule-gen.ts — extract a structured schedule (cronograma) from
 * syllabus text: quizzes, exams, assignments, weekly topics, etc.
 *
 * Same shape as graph-gen.ts: gateway (gpt-5.4) JSON output → validated rows.
 * Powers schedule-aware chat ("what quizzes this week?") and the agenda view.
 */

import { z } from "zod"
import { gatewayJson, extractJson } from "@/lib/llm/gateway-generate"
import { logError } from "@/lib/observability/logger"

export const EVENT_TYPES = [
  "quiz",
  "exam",
  "assignment",
  "project",
  "class",
  "reading",
  "other",
] as const

export type EventType = (typeof EVENT_TYPES)[number]

const ScheduleSchema = z.object({
  events: z.array(
    z.object({
      type: z.string(),
      title: z.string(),
      description: z.string(),
      date: z.string(), // ISO yyyy-mm-dd, or "" if not stated
      week_label: z.string(), // e.g. "Semana 3", or "" if not stated
      weight_percent: z.number(),
    }),
  ),
})

type Schedule = z.infer<typeof ScheduleSchema>

const SYSTEM_PROMPT =
  "You extract the academic schedule (cronograma) from a course syllabus. Identify every " +
  "dated or weekly item: quizzes, exams, assignments, projects, readings, and the topics " +
  "covered each week (use type 'class' for weekly topic coverage). Preserve the original " +
  "language of titles. Only output an ISO date when the syllabus gives a concrete one; " +
  "otherwise leave date empty and fill week_label. Do not invent dates or items.\n\n" +
  `Each event.type is one of: ${EVENT_TYPES.join(", ")}. date is ISO yyyy-mm-dd or "" ` +
  'when not stated. JSON shape: {"events":[{"type":string,"title":string,' +
  '"description":string,"date":string,"week_label":string,"weight_percent":number}]}'

export interface ExtractedEvent {
  type: EventType
  title: string
  description: string | null
  date: string | null // ISO yyyy-mm-dd or null
  weekLabel: string | null
  weightPercent: number | null
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function normType(t: string): EventType {
  const v = t.toLowerCase().trim()
  return (EVENT_TYPES as readonly string[]).includes(v) ? (v as EventType) : "other"
}

/** Extract schedule events from syllabus text. Returns [] when none are found. */
export async function extractScheduleFromText(syllabusText: string): Promise<ExtractedEvent[]> {
  try {
    // Cap the prompt so a large document doesn't make this call slow/costly.
    // Schedule items (dates, exams) cluster near the top of a syllabus.
    const raw = await gatewayJson(
      SYSTEM_PROMPT,
      `Extract the schedule from this syllabus text:\n\n${syllabusText.slice(0, 60_000)}`,
    )
    const parsed: Schedule = ScheduleSchema.parse(JSON.parse(extractJson(raw)))

    return parsed.events
      .filter((e) => e.title.trim().length > 0)
      .map((e) => ({
        type: normType(e.type),
        title: e.title.trim(),
        description: e.description.trim() || null,
        date: ISO_DATE.test(e.date.trim()) ? e.date.trim() : null,
        weekLabel: e.week_label.trim() || null,
        weightPercent:
          Number.isFinite(e.weight_percent) && e.weight_percent > 0 ? e.weight_percent : null,
      }))
  } catch (err) {
    logError("rag.schedule_gen.error", { error: err instanceof Error ? err.message : String(err) })
    throw err
  }
}
