/**
 * agenda-filter.ts — pure facet/filter logic for the Agenda calendar.
 *
 * The calendar shows every date extracted from the user's PDFs/cronogramas.
 * Filters narrow that set by course, by source document, and by event type.
 * Kept out of React so it stays unit-testable.
 */

import { resolveCourseColor } from "./course-color"

export interface FilterableEvent {
  syllabus_id: string
  course_id: string | null
  course_name: string
  doc_name: string
  /** The course's persisted color (hex), null when unset. */
  course_color?: string | null
  event_type: string
}

export interface Facet {
  /** Stable key used in the filter sets. */
  key: string
  label: string
  /** How many events carry this facet value. */
  count: number
  /** Course facets only: the color the course renders with. */
  color?: string
}

export interface AgendaFilter {
  /** Course keys (see `courseKey`). Empty = no course filter. */
  courses: string[]
  /** Source document ids (`syllabus_id`). Empty = no document filter. */
  docs: string[]
  /** Event types (`quiz`, `exam`, …). Empty = no type filter. */
  types: string[]
}

export const EMPTY_FILTER: AgendaFilter = { courses: [], docs: [], types: [] }

/**
 * Grouping key for the course facet (and for the calendar's color palette).
 * Docs not yet filed into a course group by their own document instead.
 */
export function courseKey(e: FilterableEvent): string {
  return e.course_id ?? `doc:${e.syllabus_id}`
}

function tally(
  events: FilterableEvent[],
  keyOf: (e: FilterableEvent) => string,
  labelOf: (e: FilterableEvent) => string,
  colorOf?: (e: FilterableEvent) => string,
): Facet[] {
  const map = new Map<string, Facet>()
  for (const e of events) {
    const key = keyOf(e)
    const cur = map.get(key)
    if (cur) cur.count++
    else map.set(key, { key, label: labelOf(e), count: 1, color: colorOf?.(e) })
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label, "es"))
}

/** Course / document / type facets present in the given events, with counts. */
export function buildFacets(events: FilterableEvent[]): {
  courses: Facet[]
  docs: Facet[]
  types: Facet[]
} {
  return {
    courses: tally(
      events,
      courseKey,
      (e) => e.course_name,
      (e) => resolveCourseColor(e.course_color, courseKey(e)),
    ),
    docs: tally(
      events,
      (e) => e.syllabus_id,
      (e) => e.doc_name,
    ),
    types: tally(
      events,
      (e) => e.event_type,
      (e) => e.event_type,
    ),
  }
}

/** AND across facets, OR within a facet. An empty facet list means "all". */
export function applyFilter<T extends FilterableEvent>(events: T[], f: AgendaFilter): T[] {
  const courses = new Set(f.courses)
  const docs = new Set(f.docs)
  const types = new Set(f.types)
  return events.filter(
    (e) =>
      (courses.size === 0 || courses.has(courseKey(e))) &&
      (docs.size === 0 || docs.has(e.syllabus_id)) &&
      (types.size === 0 || types.has(e.event_type)),
  )
}

/** Toggle one value inside a facet list (immutable). */
export function toggle(list: string[], key: string): string[] {
  return list.includes(key) ? list.filter((k) => k !== key) : [...list, key]
}

export function isFilterActive(f: AgendaFilter): boolean {
  return f.courses.length > 0 || f.docs.length > 0 || f.types.length > 0
}

/**
 * Drop facet selections that no longer exist in the data (e.g. a deleted doc),
 * so a stale filter can't silently blank the calendar.
 */
export function pruneFilter(f: AgendaFilter, events: FilterableEvent[]): AgendaFilter {
  const facets = buildFacets(events)
  const keep = (list: string[], fs: Facet[]) => {
    const valid = new Set(fs.map((x) => x.key))
    return list.filter((k) => valid.has(k))
  }
  return {
    courses: keep(f.courses, facets.courses),
    docs: keep(f.docs, facets.docs),
    types: keep(f.types, facets.types),
  }
}
