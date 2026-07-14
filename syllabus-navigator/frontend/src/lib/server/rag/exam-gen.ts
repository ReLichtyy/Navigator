/**
 * exam-gen.ts — types + pure helpers for the Examen mode's open-ended item
 * kinds and scoring. The short-answer (`RecallItem`) and development
 * (`CaseItem`) shapes are the bank payloads for study_items types 'recall' and
 * 'case'; the generator agents live in agents/recall.ts and agents/case.ts.
 * Everything here is pure (normalization + points math) so it stays
 * unit-testable without LLM or DB.
 */

/** Short-answer item: graded against expectedAnswer + keyPoints coverage. */
export interface RecallItem {
  question: string
  expectedAnswer: string
  keyPoints: string[]
  topic?: string
}

/** Development/application exercise: graded against rubric + modelSolution. */
export interface CaseItem {
  prompt: string
  rubric: string[]
  modelSolution: string
  topic?: string
}

function cleanStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  return values
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter(Boolean)
}

/** Keep only items with a real question, answer and ≥1 key point. */
export function normalizeRecallItems(raw: unknown): RecallItem[] {
  if (!Array.isArray(raw)) return []
  const out: RecallItem[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const r = item as Record<string, unknown>
    const question = typeof r.question === "string" ? r.question.trim() : ""
    const expectedAnswer = typeof r.expectedAnswer === "string" ? r.expectedAnswer.trim() : ""
    const keyPoints = cleanStrings(r.keyPoints)
    if (!question || !expectedAnswer || keyPoints.length === 0) continue
    const topic = typeof r.topic === "string" && r.topic.trim() ? r.topic.trim() : undefined
    out.push({ question, expectedAnswer, keyPoints, topic })
  }
  return out
}

/** Keep only items with a real prompt, ≥1 rubric criterion and a model solution. */
export function normalizeCaseItems(raw: unknown): CaseItem[] {
  if (!Array.isArray(raw)) return []
  const out: CaseItem[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const r = item as Record<string, unknown>
    const prompt = typeof r.prompt === "string" ? r.prompt.trim() : ""
    const rubric = cleanStrings(r.rubric)
    const modelSolution = typeof r.modelSolution === "string" ? r.modelSolution.trim() : ""
    if (!prompt || !modelSolution || rubric.length === 0) continue
    const topic = typeof r.topic === "string" && r.topic.trim() ? r.topic.trim() : undefined
    out.push({ prompt, rubric, modelSolution, topic })
  }
  return out
}

/**
 * Convert the grader's percentage (clamped to 0–100) into points on the item's
 * scale, rounded to 1 decimal so section sums stay readable ("3.5/4").
 */
export function pctToPoints(pct: number, maxPoints: number): number {
  const clamped = Math.min(100, Math.max(0, Number.isFinite(pct) ? pct : 0))
  return Math.round((clamped / 100) * maxPoints * 10) / 10
}

/** Float-safe totals for the graded item list (both sides rounded to 1 decimal). */
export function totalScore(items: { score: number; max: number }[]): {
  total: number
  maxTotal: number
} {
  const total = items.reduce((sum, i) => sum + i.score, 0)
  const maxTotal = items.reduce((sum, i) => sum + i.max, 0)
  return { total: Math.round(total * 10) / 10, maxTotal: Math.round(maxTotal * 10) / 10 }
}
