/**
 * orchestrator/planner.ts — assembles the "today session" for a syllabus.
 *
 * Step 5: closes the loop on the consumption side. Reads the spaced-repetition
 * ledger (due cards) and the Router plan (weak/urgent/heavy topics) to compose a
 * session = due reviews first + new items drawn from the bank, quiz ordered by
 * topic priority. The bank (study_items) is the source of items.
 *
 * User preferences (Configuración → Preferencias de estudio):
 *  - sessionLen (15/25/45 min) sets the item budget when the caller passes none,
 *  - spaced OFF skips the due-review (SRS) leg — the session is plan-ordered only,
 *  - mixSubjects ON folds a few bank items from the user's other courses in.
 */
import { GraphRepository } from "../../repositories/graph.repo"
import { StudyStatsRepository } from "../../repositories/study-stats.repo"
import { StudyItemsRepository, type StudyScope } from "../../repositories/study-items.repo"
import { DocumentRepository } from "../../repositories/document.repo"
import { getUserPrefs } from "../../utils/user-prefs"
import { buildStudyPlan } from "./router"
import { topicKey } from "../../repositories/mastery.repo"
import { logError } from "@/lib/observability/logger"
import type { Flashcard, QuizQuestion } from "../study-gen"

export interface TodaySession {
  dueCount: number
  dueCardKeys: string[]
  flashcards: Flashcard[]
  quiz: QuizQuestion[]
  targets: { label: string; priority: number; mastery: number }[]
}

// Session minutes → item budget. ~30–40s per item plus review overhead.
const SESSION_BUDGET: Record<number, number> = { 15: 8, 25: 12, 45: 20 }
const DEFAULT_SIZE = 12
// mixSubjects: how many other courses to draw from, and how many items each.
const MIX_COURSES = 2

/** Interleave extras into a base list (one extra after every two base items). */
function interleave<T>(base: T[], extras: T[], limit: number): T[] {
  if (extras.length === 0) return base.slice(0, limit)
  const out: T[] = []
  let e = 0
  for (let i = 0; i < base.length && out.length < limit; i++) {
    out.push(base[i])
    if ((i + 1) % 2 === 0 && e < extras.length && out.length < limit) out.push(extras[e++])
  }
  while (out.length < limit && e < extras.length) out.push(extras[e++])
  return out
}

export async function getTodaySession(
  userId: string,
  syllabusId: string,
  size?: number,
): Promise<TodaySession> {
  const scope: StudyScope = { kind: "doc", id: syllabusId }

  // Preferences: session budget + SRS/mix toggles (cached read, safe defaults).
  const prefs = await getUserPrefs(userId)
  const study = prefs.profile.study ?? {}
  const spaced = study.spaced !== false // default ON
  const mixSubjects = study.mixSubjects === true // default OFF
  const budget =
    size ?? (study.sessionLen ? SESSION_BUDGET[study.sessionLen] : undefined) ?? DEFAULT_SIZE

  const { topics } = await GraphRepository.getGraph(syllabusId)
  const weighted = topics
    .filter((t) => (t.weight_percent ?? 0) > 0)
    .map((t) => ({ label: t.label, weight: Number(t.weight_percent) }))

  const [plan, due, bankFlash, bankQuiz] = await Promise.all([
    buildStudyPlan(userId, scope, weighted, "medio"),
    // spaced OFF → no due-review leg: the session orders purely by the plan.
    spaced ? StudyStatsRepository.listDue(userId, scope, budget) : Promise.resolve([]),
    StudyItemsRepository.listRecent<Flashcard>(scope, "flashcard", budget),
    StudyItemsRepository.listRecent<QuizQuestion>(scope, "quiz", budget * 2),
  ])

  // Order quiz by the plan's topic priority (weak/urgent/heavy first).
  const priorityByKey = new Map(plan.targets.map((t) => [t.topicKey, t.priority]))
  let quiz = bankQuiz
    .map((b) => b.payload)
    .sort((a, b) => {
      const pa = a.topic ? (priorityByKey.get(topicKey(a.topic)) ?? 0) : 0
      const pb = b.topic ? (priorityByKey.get(topicKey(b.topic)) ?? 0) : 0
      return pb - pa
    })
    .slice(0, budget)
  let flashcards = bankFlash.map((b) => b.payload)

  // Mezclar materias: fold a few bank items from the user's other processed
  // courses into the queue (best-effort; the session never fails because of it).
  if (mixSubjects) {
    try {
      const docs = await DocumentRepository.listUploads(userId)
      const others = docs
        .filter((d) => d.id !== syllabusId && d.status === "processed")
        .slice(0, MIX_COURSES)
      const perCourse = Math.max(1, Math.floor(budget / 4))
      const extras = await Promise.all(
        others.map(async (d) => {
          const s: StudyScope = { kind: "doc", id: d.id }
          const [f, q] = await Promise.all([
            StudyItemsRepository.listRecent<Flashcard>(s, "flashcard", perCourse),
            StudyItemsRepository.listRecent<QuizQuestion>(s, "quiz", perCourse),
          ])
          return { flash: f.map((b) => b.payload), quiz: q.map((b) => b.payload) }
        }),
      )
      const extraFlash = extras.flatMap((x) => x.flash)
      const extraQuiz = extras.flatMap((x) => x.quiz)
      flashcards = interleave(flashcards, extraFlash, budget)
      quiz = interleave(quiz, extraQuiz, budget)
    } catch (err) {
      logError("rag.planner.mix_error", {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return {
    dueCount: due.length,
    dueCardKeys: due,
    flashcards,
    quiz,
    targets: plan.targets.slice(0, 8).map((t) => ({
      label: t.label,
      priority: Number(t.priority.toFixed(3)),
      mastery: t.mastery,
    })),
  }
}
