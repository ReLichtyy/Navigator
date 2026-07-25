import { critiqueQuiz, critiqueFlashcards } from "../agents/critic"
import type { QuizQuestion, Flashcard } from "../study-gen"
import { logInfo } from "@/lib/observability/logger"

function validQuiz(question: QuizQuestion): boolean {
  const normalized = question.options.map((option) => option.trim().toLocaleLowerCase())
  return (
    question.question.trim().length > 0 &&
    question.explanation.trim().length > 0 &&
    Number.isInteger(question.answer) &&
    question.answer >= 0 &&
    question.answer < question.options.length &&
    question.options.length >= 2 &&
    normalized.every(Boolean) &&
    new Set(normalized).size === normalized.length
  )
}

/** Deterministic validation first, then a fail-closed independent critic. */
export async function gateQuiz(quiz: QuizQuestion[], evidence: string): Promise<QuizQuestion[]> {
  if (quiz.length === 0) return quiz
  const candidates = quiz.filter(validQuiz)
  if (candidates.length === 0) return []
  const verdicts = await critiqueQuiz(candidates, evidence)
  let unsound = 0
  let ungrounded = 0
  let shallow = 0
  const kept = candidates.filter((_, index) => {
    const verdict = verdicts[index]
    if (!verdict) {
      ungrounded++
      return false
    }
    if (!verdict.sound) unsound++
    else if (!verdict.grounded) ungrounded++
    else if (!verdict.substantive) shallow++
    return verdict.sound && verdict.grounded && verdict.substantive
  })
  const dropped = quiz.length - kept.length
  if (dropped > 0) {
    logInfo("rag.eval.quiz_dropped", {
      dropped,
      total: quiz.length,
      unsound,
      ungrounded,
      shallow,
    })
  }
  return kept
}

/** Flashcards use the same fail-closed grounding contract. */
export async function gateFlashcards(cards: Flashcard[], evidence: string): Promise<Flashcard[]> {
  if (cards.length === 0) return cards
  const candidates = cards.filter(
    (card) => card.front.trim().length > 0 && card.back.trim().length > 0,
  )
  if (candidates.length === 0) return []
  const verdicts = await critiqueFlashcards(candidates, evidence)
  let inaccurate = 0
  let ungrounded = 0
  let shallow = 0
  const kept = candidates.filter((_, index) => {
    const verdict = verdicts[index]
    if (!verdict) {
      ungrounded++
      return false
    }
    if (!verdict.accurate) inaccurate++
    else if (!verdict.grounded) ungrounded++
    else if (!verdict.substantive) shallow++
    return verdict.accurate && verdict.grounded && verdict.substantive
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
