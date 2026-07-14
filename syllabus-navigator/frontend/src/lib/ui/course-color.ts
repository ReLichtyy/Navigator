/**
 * course-color.ts — the one palette for course colors.
 *
 * A course's color is persisted (`user_courses.color`, a hex string) and picked
 * at creation (random by default, overridable) or later from the course folder.
 * Courses created before this existed have `color = null`, so every consumer
 * resolves through `resolveCourseColor`, which falls back to a stable hash of
 * the course key. Same input → same color, everywhere (Cursos + Agenda).
 */

export interface CourseColor {
  hex: string
  label: string
}

export const COURSE_COLORS: CourseColor[] = [
  { hex: "#3FBF84", label: "Verde" },
  { hex: "#60a5fa", label: "Azul" },
  { hex: "#c084fc", label: "Morado" },
  { hex: "#fbbf24", label: "Ámbar" },
  { hex: "#f472b6", label: "Rosa" },
  { hex: "#f87171", label: "Rojo" },
  { hex: "#22d3ee", label: "Cian" },
  { hex: "#a3e635", label: "Lima" },
]

export const COURSE_COLOR_HEXES = COURSE_COLORS.map((c) => c.hex)

const HEX_RE = /^#[0-9a-fA-F]{6}$/

export function isCourseColor(value: string | null | undefined): value is string {
  return typeof value === "string" && HEX_RE.test(value)
}

/** Stable palette index for a key (course id, or `doc:<id>` for uncategorised). */
export function colorIndexFor(key: string): number {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return h % COURSE_COLOR_HEXES.length
}

/** The color a course actually renders with: its own, else a hash of its key. */
export function resolveCourseColor(color: string | null | undefined, key: string): string {
  return isCourseColor(color) ? color : COURSE_COLOR_HEXES[colorIndexFor(key)]
}

/**
 * Default color for a new course: a random one, preferring a hue not already
 * taken by another course so folders stay visually distinct.
 */
export function randomCourseColor(used: (string | null | undefined)[] = []): string {
  const taken = new Set(used.filter(isCourseColor).map((c) => c.toLowerCase()))
  const free = COURSE_COLOR_HEXES.filter((c) => !taken.has(c.toLowerCase()))
  const pool = free.length > 0 ? free : COURSE_COLOR_HEXES
  return pool[Math.floor(Math.random() * pool.length)]
}

/** Translucent version of a color, for icon/chip backgrounds. */
export function colorTint(hex: string, alpha = "22"): string {
  return `${hex}${alpha}`
}
