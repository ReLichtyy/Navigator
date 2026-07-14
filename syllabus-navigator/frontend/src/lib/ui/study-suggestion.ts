/**
 * study-suggestion.ts — pick the single most relevant study mode for a course
 * from its cronograma events. Pure → unit-testable. Powers the "Sugerido" badge
 * on the Área de Estudio mode cards.
 *
 * Logic (first match wins):
 *   1. A graded assessment (quiz/exam) dated today..+HORIZON days → suggest
 *      "examen", with a human reason ("hoy" / "mañana" / "en N días").
 *   2. Otherwise, if the course has topics this week → suggest "quiz".
 *   3. Otherwise → no suggestion.
 */

interface DatedEvent {
  event_type: string
  event_date: string | null
}

export type SuggestedMode = "examen" | "quiz"

export interface StudySuggestion {
  mode: SuggestedMode
  /** Short badge text, e.g. "en 3 días", "mañana", "esta semana". */
  reason: string
}

const ISO = /^\d{4}-\d{2}-\d{2}$/
const ASSESSMENT_TYPES = new Set(["quiz", "exam"])
// How far ahead an assessment still drives the "examen" suggestion.
const HORIZON_DAYS = 14

/** Whole-day difference toISO − fromISO (UTC, avoids tz drift). NaN on bad input. */
function daysBetween(fromISO: string, toISO: string): number {
  const a = Date.parse(`${fromISO}T00:00:00Z`)
  const b = Date.parse(`${toISO}T00:00:00Z`)
  return Math.round((b - a) / 86_400_000)
}

export function pickStudySuggestion(
  events: DatedEvent[],
  today: string | undefined,
  hasWeekTopics: boolean,
): StudySuggestion | null {
  if (today && ISO.test(today)) {
    const upcoming = events
      .filter((e) => ASSESSMENT_TYPES.has(e.event_type) && e.event_date && ISO.test(e.event_date))
      .map((e) => daysBetween(today, e.event_date!))
      .filter((d) => Number.isFinite(d) && d >= 0 && d <= HORIZON_DAYS)
      .sort((a, b) => a - b)

    const d = upcoming[0]
    if (d !== undefined) {
      const reason = d === 0 ? "hoy" : d === 1 ? "mañana" : `en ${d} días`
      return { mode: "examen", reason }
    }
  }

  if (hasWeekTopics) return { mode: "quiz", reason: "esta semana" }
  return null
}
