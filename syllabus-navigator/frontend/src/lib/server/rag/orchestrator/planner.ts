/**
 * orchestrator/planner.ts — assembles the "today session" for a syllabus.
 *
 * Step 5: closes the loop on the consumption side. Reads the spaced-repetition
 * ledger (due cards) and the Router plan (weak/urgent/heavy topics) to compose a
 * session = due reviews first + new items drawn from the bank, quiz ordered by
 * topic priority. The bank (study_items) is the source of items.
 */
import { GraphRepository } from "../../repositories/graph.repo"
import { StudyStatsRepository } from "../../repositories/study-stats.repo"
import { StudyItemsRepository, type StudyScope } from "../../repositories/study-items.repo"
import { buildStudyPlan } from "./router"
import { topicKey } from "../../repositories/mastery.repo"
import type { Flashcard, QuizQuestion } from "../study-gen"

export interface TodaySession {
  dueCount: number
  dueCardKeys: string[]
  flashcards: Flashcard[]
  quiz: QuizQuestion[]
  targets: { label: string; priority: number; mastery: number }[]
}

export async function getTodaySession(
  userId: string,
  syllabusId: string,
  size = 12,
): Promise<TodaySession> {
  const scope: StudyScope = { kind: "doc", id: syllabusId }

  const { topics } = await GraphRepository.getGraph(syllabusId)
  const weighted = topics
    .filter((t) => (t.weight_percent ?? 0) > 0)
    .map((t) => ({ label: t.label, weight: Number(t.weight_percent) }))

  const [plan, due, bankFlash, bankQuiz] = await Promise.all([
    buildStudyPlan(userId, syllabusId, weighted, "medio"),
    StudyStatsRepository.listDue(userId, syllabusId, size),
    StudyItemsRepository.listRecent<Flashcard>(scope, "flashcard", size),
    StudyItemsRepository.listRecent<QuizQuestion>(scope, "quiz", size * 2),
  ])

  // Order quiz by the plan's topic priority (weak/urgent/heavy first).
  const priorityByKey = new Map(plan.targets.map((t) => [t.topicKey, t.priority]))
  const quiz = bankQuiz
    .map((b) => b.payload)
    .sort((a, b) => {
      const pa = a.topic ? (priorityByKey.get(topicKey(a.topic)) ?? 0) : 0
      const pb = b.topic ? (priorityByKey.get(topicKey(b.topic)) ?? 0) : 0
      return pb - pa
    })
    .slice(0, size)

  return {
    dueCount: due.length,
    dueCardKeys: due,
    flashcards: bankFlash.map((b) => b.payload),
    quiz,
    targets: plan.targets.slice(0, 8).map((t) => ({
      label: t.label,
      priority: Number(t.priority.toFixed(3)),
      mastery: t.mastery,
    })),
  }
}
