/**
 * server/rag/week-date.ts — resolve "Semana N" labels into real dates.
 *
 * schedule-gen extracts events with a `week_label` ("Semana 3") when the
 * syllabus carries no ISO date. Given the course's `term_start` (the Monday of
 * week 1), week N starts at `term_start + (N-1)*7 days`. Resolution happens at
 * serve time and is never persisted, so correcting term_start recalculates
 * every derived date.
 */

const WEEK_LABEL_RE = /^\s*(?:semana|week|sem|wk|s|w)\s*\.?\s*#?\s*(\d{1,2})\s*$/i
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Parse "Semana 3" / "Week 3" / "S3" / "sem. 03" → 3. Null when malformed. */
export function parseWeekNumber(label: string): number | null {
  const m = WEEK_LABEL_RE.exec(label)
  if (!m) return null
  const n = parseInt(m[1], 10)
  return n >= 1 ? n : null
}

function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

/**
 * Start date (Monday) of the labelled week: `term_start + (N-1)*7 days`.
 * Null when the label doesn't parse or termStart isn't a valid ISO date.
 */
export function resolveWeekDate(termStart: string, weekLabel: string): string | null {
  if (!ISO_DATE_RE.test(termStart)) return null
  const n = parseWeekNumber(weekLabel)
  if (n === null) return null
  const d = new Date(termStart + "T00:00:00")
  if (Number.isNaN(d.getTime())) return null
  d.setDate(d.getDate() + (n - 1) * 7)
  return toISO(d)
}

/**
 * Monday of the week containing the given ISO date. Used to normalize an
 * inferred term-start (the anchor is defined as the Monday of week 1).
 * Null on malformed input.
 */
export function mondayOf(iso: string): string | null {
  if (!ISO_DATE_RE.test(iso)) return null
  const d = new Date(iso + "T00:00:00")
  if (Number.isNaN(d.getTime())) return null
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return toISO(d)
}

/** ISO date + n days (n may be negative). */
export function isoAddDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00")
  d.setDate(d.getDate() + n)
  return toISO(d)
}

type WeekDatable = {
  event_date: string | null
  week_label: string | null
  term_start?: string | null
}

/**
 * Fill `event_date` on events that only carry a `week_label`, when their
 * course has a `term_start`. Dated events pass through untouched. Re-sorts
 * dated-first (stable, so the repo's created_at ordering is preserved within
 * equal dates).
 */
export function resolveEventWeekDates<T extends WeekDatable>(events: T[]): T[] {
  return events
    .map((e) => {
      if (e.event_date || !e.week_label || !e.term_start) return e
      const resolved = resolveWeekDate(e.term_start, e.week_label)
      return resolved ? { ...e, event_date: resolved } : e
    })
    .sort((a, b) => (a.event_date ?? "9999-12-31").localeCompare(b.event_date ?? "9999-12-31"))
}
