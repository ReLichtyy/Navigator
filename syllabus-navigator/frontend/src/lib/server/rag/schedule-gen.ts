/**
 * server/rag/schedule-gen.ts — extract a structured schedule (cronograma) from
 * syllabus text: quizzes, exams, assignments, weekly topics, etc.
 *
 * Same shape as graph-gen.ts: OpenAI strict structured output → validated rows.
 * Powers schedule-aware chat ("what quizzes this week?") and the agenda view.
 */

import OpenAI from "openai"
import { z } from "zod"
import { DEFAULT_MODEL, isNextGenModel } from "@/lib/llm/config"
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

const SCHEDULE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    events: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          type: {
            type: "string",
            enum: EVENT_TYPES,
            description: "Kind of event",
          },
          title: { type: "string", description: "Short title, e.g. 'Quiz 1: Límites'" },
          description: { type: "string", description: "Extra detail; empty string if none" },
          date: {
            type: "string",
            description:
              "Absolute date as ISO yyyy-mm-dd if the syllabus states one (resolve relative phrases only when an explicit date is present). Empty string if no concrete date.",
          },
          week_label: {
            type: "string",
            description: "Week marker like 'Semana 3' / 'Week 3' if present, else empty string",
          },
          weight_percent: {
            type: "number",
            description: "Grade weight 0-100 if stated for this item, else 0",
          },
        },
        required: ["type", "title", "description", "date", "week_label", "weight_percent"],
      },
    },
  },
  required: ["events"],
} as const

const SYSTEM_PROMPT =
  "You extract the academic schedule (cronograma) from a course syllabus. Identify every " +
  "dated or weekly item: quizzes, exams, assignments, projects, readings, and the topics " +
  "covered each week (use type 'class' for weekly topic coverage). Preserve the original " +
  "language of titles. Only output an ISO date when the syllabus gives a concrete one; " +
  "otherwise leave date empty and fill week_label. Do not invent dates or items."

export interface ExtractedEvent {
  type: EventType
  title: string
  description: string | null
  date: string | null // ISO yyyy-mm-dd or null
  weekLabel: string | null
  weightPercent: number | null
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

let _client: OpenAI | null = null
function getClient(): OpenAI {
  if (!_client) {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) throw new Error("OPENAI_API_KEY is not configured")
    _client = new OpenAI({ apiKey })
  }
  return _client
}

function normType(t: string): EventType {
  const v = t.toLowerCase().trim()
  return (EVENT_TYPES as readonly string[]).includes(v) ? (v as EventType) : "other"
}

/** Extract schedule events from syllabus text. Returns [] when none are found. */
export async function extractScheduleFromText(syllabusText: string): Promise<ExtractedEvent[]> {
  const client = getClient()
  try {
    const completion = await client.chat.completions.create({
      model: DEFAULT_MODEL,
      // GPT-5/o-series reject non-default temperature → omit it for those (BUG-001).
      ...(isNextGenModel(DEFAULT_MODEL) ? {} : { temperature: 0 }),
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Extract the schedule from this syllabus text:\n\n${syllabusText}`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "syllabus_schedule",
          strict: true,
          schema: SCHEDULE_JSON_SCHEMA as unknown as Record<string, unknown>,
        },
      },
    })

    const raw = completion.choices[0]?.message?.content ?? "{}"
    const parsed: Schedule = ScheduleSchema.parse(JSON.parse(raw))

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
