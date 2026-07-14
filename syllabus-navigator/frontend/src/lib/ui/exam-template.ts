/**
 * exam-template.ts — exam layout templates for the Examen mode, shared by the
 * client (pre-exam config screen) and the server (paper assembly). Which
 * sections an exam has and how many points each item is worth depends on the
 * subject: a theory-heavy course leans on multiple choice + short answers, a
 * calculation/practice course on development exercises. `inferTemplate` picks
 * the template from the course's subject signal (free-form subject_tags +
 * name); the user can always override it before starting.
 * Pure → unit-testable; no server or client imports.
 */

export type ExamTemplateId = "teorico" | "practico" | "mixto"

export type ExamSectionKind = "mcq" | "short" | "dev"

export interface ExamTemplateSection {
  kind: ExamSectionKind
  label: string
  count: number
  pointsPerItem: number
}

export interface ExamTemplate {
  id: ExamTemplateId
  label: string
  description: string
  sections: ExamTemplateSection[]
  /** Fixed exam duration in seconds (20 min for every template). */
  durationSec: number
}

const DURATION_SEC = 20 * 60

const MCQ_LABEL = "Sección I — Opción múltiple (marque con X)"
const SHORT_LABEL = "Sección II — Respuesta corta"
const DEV_LABEL = "Sección III — Desarrollo"

/** Every template's points sum to 20 (the /20 grading scale). */
export const EXAM_TEMPLATES: Record<ExamTemplateId, ExamTemplate> = {
  teorico: {
    id: "teorico",
    label: "Teórico",
    description: "Más opción múltiple y respuestas cortas, un ensayo de desarrollo.",
    sections: [
      { kind: "mcq", label: MCQ_LABEL, count: 10, pointsPerItem: 1 },
      { kind: "short", label: SHORT_LABEL, count: 4, pointsPerItem: 1.5 },
      { kind: "dev", label: DEV_LABEL, count: 1, pointsPerItem: 4 },
    ],
    durationSec: DURATION_SEC,
  },
  practico: {
    id: "practico",
    label: "Práctico",
    description: "Menos opción múltiple, más ejercicios de desarrollo y aplicación.",
    sections: [
      { kind: "mcq", label: MCQ_LABEL, count: 6, pointsPerItem: 1 },
      { kind: "short", label: SHORT_LABEL, count: 2, pointsPerItem: 2 },
      { kind: "dev", label: DEV_LABEL, count: 2, pointsPerItem: 5 },
    ],
    durationSec: DURATION_SEC,
  },
  mixto: {
    id: "mixto",
    label: "Mixto",
    description: "Balance entre teoría y aplicación.",
    sections: [
      { kind: "mcq", label: MCQ_LABEL, count: 8, pointsPerItem: 1 },
      { kind: "short", label: SHORT_LABEL, count: 3, pointsPerItem: 2 },
      { kind: "dev", label: DEV_LABEL, count: 1, pointsPerItem: 6 },
    ],
    durationSec: DURATION_SEC,
  },
}

export const EXAM_TEMPLATE_IDS = Object.keys(EXAM_TEMPLATES) as ExamTemplateId[]

/** Total points a template awards (should be 20 for every template). */
export function templateTotal(t: ExamTemplate): number {
  return t.sections.reduce((sum, s) => sum + s.count * s.pointsPerItem, 0)
}

/** Lowercase + strip diacritics so "Cálculo" matches "calculo". */
function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
}

// Keyword stems checked against normalized subject_tags + course name.
// practico wins ties (checked first): a course naming both "teoría" and
// "cálculo" is better served by exercises than by an essay.
const PRACTICO_RE = /calculo|matemat|fisic|program|algorit|estadist|quimic|ingenier/
const TEORICO_RE = /historia|teori|derecho|filosof|literat|sociolog|psicolog|human/

/**
 * Pick the exam template from the course's free-form subject signal. There is
 * no discipline taxonomy in the app — subject_tags are free text from
 * course-infer — so this is a keyword heuristic with `mixto` as the safe
 * default. The user can always override on the config screen.
 */
export function inferTemplate(subjectTags: string[], courseName: string): ExamTemplateId {
  const haystack = normalize([...subjectTags, courseName].join(" "))
  if (PRACTICO_RE.test(haystack)) return "practico"
  if (TEORICO_RE.test(haystack)) return "teorico"
  return "mixto"
}

/** "MM:SS" for the countdown header (floors negative input to 00:00). */
export function formatCountdown(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec))
  const mm = String(Math.floor(s / 60)).padStart(2, "0")
  const ss = String(s % 60).padStart(2, "0")
  return `${mm}:${ss}`
}
