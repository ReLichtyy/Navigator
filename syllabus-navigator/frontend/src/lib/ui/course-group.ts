/**
 * course-group.ts — group flat syllabus uploads into "courses" for the Cursos
 * window (UI-11). Until uploads carry a real course FK, the course code is
 * parsed from the filename (e.g. "ISW-524 Diseño…pdf" → code "ISW-524").
 */
import type { SyllabusUploadAPI } from "@/lib/api"

/** Course code at the start of a filename, normalized to "ABC-123", else null. */
export function parseCourseCode(filename: string): string | null {
  const m = filename.match(/\b([A-Za-z]{2,4})[-\s]?(\d{2,4})\b/)
  if (!m) return null
  return `${m[1].toUpperCase()}-${m[2]}`
}

/** Human course name: filename minus the code prefix, extension and version tags. */
export function courseName(filename: string, code: string | null): string {
  let name = filename.replace(/\.pdf$/i, "")
  if (code) {
    const [alpha, num] = code.split("-")
    name = name.replace(new RegExp(`\\b${alpha}[-\\s]?${num}\\b`, "i"), " ")
  }
  // Drop leading term/version noise like "II-2026", "(V)", stray separators.
  name = name
    .replace(/\b[IVX]{1,3}-\d{4}\b/gi, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  return name || filename.replace(/\.pdf$/i, "")
}

export interface CourseGroup {
  /** Stable group key — the code, or "OTROS" when no code is detectable. */
  key: string
  /** Display code, or null when ungrouped. */
  code: string | null
  name: string
  docs: SyllabusUploadAPI[]
}

/** Group uploads by parsed course code, sorted by code then name. */
export function groupByCourse(uploads: SyllabusUploadAPI[]): CourseGroup[] {
  const map = new Map<string, CourseGroup>()

  for (const u of uploads) {
    const code = parseCourseCode(u.original_filename)
    const key = code ?? "OTROS"
    let g = map.get(key)
    if (!g) {
      g = { key, code, name: code ? courseName(u.original_filename, code) : "Otros", docs: [] }
      map.set(key, g)
    }
    g.docs.push(u)
  }

  return [...map.values()].sort((a, b) => {
    if (a.key === "OTROS") return 1
    if (b.key === "OTROS") return -1
    return a.key.localeCompare(b.key)
  })
}

// ---------------------------------------------------------------------------
// Real course grouping (Course Intelligence Layer) — group by the confirmed
// course_id FK instead of the filename. Empty courses are shown so the user
// sees every folder; documents without a course fall into a "Sin curso" bucket.
// ---------------------------------------------------------------------------
export interface RealCourse {
  id: string
  name: string
  color: string | null
}

export interface RealCourseGroup {
  /** Course id, or null for the "Sin curso" bucket. */
  id: string | null
  name: string
  color: string | null
  docs: SyllabusUploadAPI[]
}

export function groupByRealCourse(
  uploads: SyllabusUploadAPI[],
  courses: RealCourse[],
): RealCourseGroup[] {
  const known = new Set(courses.map((c) => c.id))
  const byCourse = new Map<string, SyllabusUploadAPI[]>()
  const uncategorized: SyllabusUploadAPI[] = []

  for (const u of uploads) {
    // A course_id pointing at a course we don't know about (e.g. a refetch race)
    // is treated as uncategorised so the document never disappears.
    if (u.course_id && known.has(u.course_id)) {
      const arr = byCourse.get(u.course_id) ?? []
      arr.push(u)
      byCourse.set(u.course_id, arr)
    } else {
      uncategorized.push(u)
    }
  }

  const groups: RealCourseGroup[] = courses
    .map((c) => ({ id: c.id, name: c.name, color: c.color, docs: byCourse.get(c.id) ?? [] }))
    .sort((a, b) => a.name.localeCompare(b.name))

  if (uncategorized.length > 0) {
    groups.push({ id: null, name: "Sin curso", color: null, docs: uncategorized })
  }
  return groups
}
