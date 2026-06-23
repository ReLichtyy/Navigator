/**
 * week-topics.ts — pick the N most week-relevant topic titles for a course from
 * its cronograma events. Pure → unit-testable. Powers the Área de Estudio topic
 * suggestions ("General" + 3 topics of the current week).
 *
 * Priority order:
 *   1. events dated within the current week [weekStart, weekEnd]
 *   2. nearest upcoming events (date >= today)
 *   3. any remaining events
 * De-duplicated by title, capped at `limit`.
 */

interface DatedEvent {
  title: string
  event_date: string | null
}

const ISO = /^\d{4}-\d{2}-\d{2}$/

export function pickWeekTopics(
  events: DatedEvent[],
  range: { today?: string; weekStart?: string; weekEnd?: string },
  limit = 3,
): string[] {
  const today = range.today ?? "9999-12-31"
  const ws = range.weekStart ?? ""
  const we = range.weekEnd ?? ""

  const dated = events.filter((e) => e.event_date && ISO.test(e.event_date))
  const inWeek = dated.filter((e) => ws && we && e.event_date! >= ws && e.event_date! <= we)
  const upcoming = dated
    .filter((e) => e.event_date! >= today && !inWeek.includes(e))
    .sort((a, b) => (a.event_date! < b.event_date! ? -1 : 1))
  const rest = events.filter((e) => !inWeek.includes(e) && !upcoming.includes(e))

  const ordered = [...inWeek, ...upcoming, ...rest]
  const titles: string[] = []
  for (const e of ordered) {
    const t = e.title.trim()
    if (t && !titles.includes(t)) titles.push(t)
    if (titles.length === limit) break
  }
  return titles
}
