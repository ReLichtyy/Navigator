/**
 * agenda-weeks.ts — group agenda events into the "Temas y actividades" panels.
 *
 * The week an event belongs to is decided by its REAL DATE (Monday–Sunday),
 * not by the `week_label` string the syllabus happened to use: a label only
 * becomes a date upstream, via the course's `term_start` (see rag/week-date).
 * Events that still have no date can't be placed on a week, so they are grouped
 * by the document they came from instead ("Sin fecha").
 *
 * Within a group, items keep the order the API sent them, which is the order
 * they appear in the source file (the repo sorts by date, then created_at =
 * extraction order). Identical items (same course + type + title) are collapsed
 * into one row with a count — several documents of one course often repeat the
 * same cronograma.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export interface WeekEvent {
  id: string
  syllabus_id: string
  course_id: string | null
  course_name: string
  doc_name: string
  course_color?: string | null
  event_type: string
  title: string
  event_date: string | null
  week_label: string | null
  weight_percent: number | null
}

/** One row in a group: an event plus how many duplicates it absorbed. */
export interface GroupItem<T> {
  event: T
  /** 1 when unique; >1 when identical items from other documents were merged. */
  count: number
}

export interface EventGroup<T> {
  key: string
  /** "week" → dated events of one Mon–Sun week. "doc" → undated, per document. */
  kind: "week" | "doc"
  /** Monday of the week (ISO), null for document groups. */
  weekStart: string | null
  /** Heading, e.g. "7 – 13 jul" or the document's filename. */
  label: string
  /** The week containing `today`. */
  isCurrent: boolean
  /** A week entirely before the current one. */
  isPast: boolean
  items: GroupItem<T>[]
  /** Assessments (quiz/exam/assignment/project) in this group — they lead the UI. */
  assessmentCount: number
  /** Topics/readings/classes and anything else. */
  topicCount: number
}

export const ASSESSMENT_TYPES = new Set(["quiz", "exam", "assignment", "project"])

export function isAssessment(type: string): boolean {
  return ASSESSMENT_TYPES.has(type)
}

function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

/** Monday of the week containing an ISO date. Null on malformed input. */
export function weekStartOf(iso: string): string | null {
  if (!ISO_DATE.test(iso)) return null
  const d = new Date(iso + "T00:00:00")
  if (Number.isNaN(d.getTime())) return null
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return toISO(d)
}

const MONTHS_SHORT = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
]

/** "7 – 13 jul" / "29 sep – 5 oct" for the Mon–Sun week starting at `weekStart`. */
export function weekRangeLabel(weekStart: string): string {
  const mon = new Date(weekStart + "T00:00:00")
  const sun = new Date(mon)
  sun.setDate(mon.getDate() + 6)
  const a = `${mon.getDate()} ${MONTHS_SHORT[mon.getMonth()]}`
  const b = `${sun.getDate()} ${MONTHS_SHORT[sun.getMonth()]}`
  return mon.getMonth() === sun.getMonth()
    ? `${mon.getDate()} – ${sun.getDate()} ${MONTHS_SHORT[sun.getMonth()]}`
    : `${a} – ${b}`
}

/** Identity used to collapse duplicates inside a group. */
function dedupeKey(e: WeekEvent): string {
  const course = e.course_id ?? `doc:${e.syllabus_id}`
  return `${course}|${e.event_type}|${e.title.trim().toLowerCase()}`
}

/**
 * Build the week groups (plus one "Sin fecha" group per document).
 *
 * Weeks come first, chronologically; undated document groups go last.
 */
export function buildWeekGroups<T extends WeekEvent>(events: T[], today: string): EventGroup<T>[] {
  const currentWeek = weekStartOf(today)
  const weeks = new Map<string, T[]>()
  const docs = new Map<string, T[]>()

  for (const e of events) {
    const start = e.event_date ? weekStartOf(e.event_date) : null
    if (start) {
      const arr = weeks.get(start) ?? []
      arr.push(e)
      weeks.set(start, arr)
    } else {
      const arr = docs.get(e.syllabus_id) ?? []
      arr.push(e)
      docs.set(e.syllabus_id, arr)
    }
  }

  const collapse = (evs: T[]): GroupItem<T>[] => {
    const out = new Map<string, GroupItem<T>>()
    for (const e of evs) {
      const k = dedupeKey(e)
      const cur = out.get(k)
      if (cur) cur.count++
      else out.set(k, { event: e, count: 1 })
    }
    return [...out.values()]
  }

  const counts = (items: GroupItem<T>[]) => ({
    assessmentCount: items.filter((i) => isAssessment(i.event.event_type)).length,
    topicCount: items.filter((i) => !isAssessment(i.event.event_type)).length,
  })

  const weekGroups: EventGroup<T>[] = [...weeks.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, evs]) => {
      const items = collapse(evs)
      return {
        key: `w:${weekStart}`,
        kind: "week" as const,
        weekStart,
        label: weekRangeLabel(weekStart),
        isCurrent: weekStart === currentWeek,
        isPast: currentWeek !== null && weekStart < currentWeek,
        items,
        ...counts(items),
      }
    })

  const docGroups: EventGroup<T>[] = [...docs.entries()]
    .map(([syllabusId, evs]) => {
      const items = collapse(evs)
      return {
        key: `d:${syllabusId}`,
        kind: "doc" as const,
        weekStart: null,
        label: evs[0].doc_name || evs[0].course_name,
        isCurrent: false,
        isPast: false,
        items,
        ...counts(items),
      }
    })
    .sort((a, b) => a.label.localeCompare(b.label, "es"))

  return [...weekGroups, ...docGroups]
}

/**
 * Which group the accordion opens by default: the week containing today, else
 * the next week ahead, else the first group.
 */
export function defaultGroupKey<T extends WeekEvent>(groups: EventGroup<T>[]): string | undefined {
  const current = groups.find((g) => g.isCurrent)
  if (current) return current.key
  const nextAhead = groups.find((g) => g.kind === "week" && !g.isPast)
  return (nextAhead ?? groups[0])?.key
}

/** Courses whose "Semana N" events can't be dated — they need a `term_start`. */
export function coursesMissingTermStart<T extends WeekEvent>(events: T[]): string[] {
  const names = new Set<string>()
  for (const e of events) {
    if (!e.event_date && e.week_label) names.add(e.course_name)
  }
  return [...names].sort((a, b) => a.localeCompare(b, "es"))
}
