/**
 * eval/gates.ts — quality gates applied before items are served/persisted.
 *
 * The quiz gate runs the Critic (a different model family than the inquisitor)
 * over each question and keeps only those that are sound AND grounded AND
 * substantive — this is what kills shallow-but-correct ("floja") questions, not
 * just wrong ones. Drops are logged by failing axis (no silent caps). Other gates
 * (novelty/dedup) live in the bank's embedding gate (study-items.repo).
 */
import { critiqueQuestion, critiqueFlashcard } from "../agents/critic"
import type { QuizQuestion, Flashcard } from "../study-gen"
import { logInfo } from "@/lib/observability/logger"

/**
 * Three-axis gate: keep a question only when the Critic confirms it is sound,
 * grounded in the material, and substantive. If the Critic itself fails (null),
 * the question is kept — infra failure must not silently shrink the quiz.
 */
export async function gateQuiz(quiz: QuizQuestion[], evidence: string): Promise<QuizQuestion[]> {
  if (quiz.length === 0) return quiz
  const critiques = await Promise.all(quiz.map((q) => critiqueQuestion(q, evidence)))
  let unsound = 0
  let ungrounded = 0
  let shallow = 0
  const kept = quiz.filter((_, i) => {
    const c = critiques[i]
    if (c === null) return true // critic infra failure → keep
    if (!c.sound) unsound++
    else if (!c.grounded) ungrounded++
    else if (!c.substantive) shallow++
    return c.sound && c.grounded && c.substantive
  })
  const dropped = quiz.length - kept.length
  if (dropped > 0) {
    logInfo("rag.eval.quiz_dropped", { dropped, total: quiz.length, unsound, ungrounded, shallow })
  }
  return kept
}

/**
 * Flashcard gate: keep a card only when the Critic confirms it is accurate,
 * grounded and substantive. Same fail-open contract as the quiz gate (critic
 * infra failure → keep). Brings the quiz's quality bar to the flashcards.
 */
export async function gateFlashcards(cards: Flashcard[], evidence: string): Promise<Flashcard[]> {
  if (cards.length === 0) return cards
  const critiques = await Promise.all(cards.map((c) => critiqueFlashcard(c, evidence)))
  let inaccurate = 0
  let ungrounded = 0
  let shallow = 0
  const kept = cards.filter((_, i) => {
    const c = critiques[i]
    if (c === null) return true // critic infra failure → keep
    if (!c.accurate) inaccurate++
    else if (!c.grounded) ungrounded++
    else if (!c.substantive) shallow++
    return c.accurate && c.grounded && c.substantive
  })
  const dropped = cards.length - kept.length
  if (dropped > 0) {
    logInfo("rag.eval.flashcards_dropped", { dropped, total: cards.length, inaccurate, ungrounded, shallow })
  }
  return kept
}
