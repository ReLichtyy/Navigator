/**
 * eval/gates.ts — quality gates applied before items are served/persisted.
 *
 * The quiz/flashcard gates run the Critic (a different model family than the
 * generator) over the whole set in ONE batched call and keep only items that are
 * sound/accurate AND grounded AND substantive — this kills shallow-but-correct
 * ("floja") items, not just wrong ones. Drops are logged by failing axis (no
 * silent caps). Novelty/dedup lives in the bank's embedding gate.
 */
import { critiqueQuiz, critiqueFlashcards } from "../agents/critic"
import type { QuizQuestion, Flashcard } from "../study-gen"
import { logInfo } from "@/lib/observability/logger"

/**
 * Three-axis gate: keep a question only when the Critic confirms it is sound,
 * grounded and substantive. A null verdict (critic gave none / call failed) keeps
 * the question — infra failure must not silently shrink the quiz.
 */
export async function gateQuiz(quiz: QuizQuestion[], evidence: string): Promise<QuizQuestion[]> {
  if (quiz.length === 0) return quiz
  const verdicts = await critiqueQuiz(quiz, evidence)
  let unsound = 0
  let ungrounded = 0
  let shallow = 0
  const kept = quiz.filter((_, i) => {
    const v = verdicts[i]
    if (!v) return true // no verdict → keep
    if (!v.sound) unsound++
    else if (!v.grounded) ungrounded++
    else if (!v.substantive) shallow++
    return v.sound && v.grounded && v.substantive
  })
  const dropped = quiz.length - kept.length
  if (dropped > 0) {
    logInfo("rag.eval.quiz_dropped", { dropped, total: quiz.length, unsound, ungrounded, shallow })
  }
  return kept
}

/**
 * Flashcard gate: keep a card only when the Critic confirms it is accurate,
 * grounded and substantive. Same fail-open contract as the quiz gate.
 */
export async function gateFlashcards(cards: Flashcard[], evidence: string): Promise<Flashcard[]> {
  if (cards.length === 0) return cards
  const verdicts = await critiqueFlashcards(cards, evidence)
  let inaccurate = 0
  let ungrounded = 0
  let shallow = 0
  const kept = cards.filter((_, i) => {
    const v = verdicts[i]
    if (!v) return true // no verdict → keep
    if (!v.accurate) inaccurate++
    else if (!v.grounded) ungrounded++
    else if (!v.substantive) shallow++
    return v.accurate && v.grounded && v.substantive
  })
  const dropped = cards.length - kept.length
  if (dropped > 0) {
    logInfo("rag.eval.flashcards_dropped", {
      dropped,
      total: cards.length,
      inaccurate,
      ungrounded,
      shallow,
    })
  }
  return kept
}
