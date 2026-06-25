/**
 * orchestrator/runner.ts — the Study Engine generation graph.
 *
 * Replaces the single mega-call (study-gen.generateStudySet) with specialized
 * agents run in parallel, then an answer-correctness gate over the quiz:
 *
 *   evidence → ┬→ flashcardAgent ┐
 *              ├→ inquisitorAgent ┼→ verifyQuiz (gate) → assemble StudySet
 *              └→ synthAgent     ┘
 *
 * Agents fail soft (return [] / null), so a partial set still serves. Returns
 * null only when nothing usable was produced (same contract as generateStudySet).
 */
import { flashcardAgent } from "../agents/flashcard"
import { inquisitorAgent } from "../agents/inquisitor"
import { synthAgent } from "../agents/synth"
import { verifyQuiz } from "../eval/gates"
import type { StudySet, StudyGenOptions } from "../study-gen"

export async function orchestrateStudySet(
  evidence: string,
  opts: StudyGenOptions = {},
): Promise<StudySet | null> {
  const text = evidence.trim()
  if (text.length < 80) return null

  // Generate the three artifact families in parallel.
  const [flashcards, rawQuiz, synth] = await Promise.all([
    flashcardAgent(text, opts),
    inquisitorAgent(text, opts),
    synthAgent(text, opts),
  ])

  // Answer-correctness gate over the quiz (cross-family verification).
  const quiz = await verifyQuiz(rawQuiz, text)

  const summary = synth?.summary ?? { intro: "", points: [] }
  const mindmap = synth?.mindmap ?? { center: "", branches: [] }

  const set: StudySet = {
    flashcards,
    quiz,
    summary,
    mindmap,
    ...(synth?.studyGuide && synth.studyGuide.length > 0 ? { studyGuide: synth.studyGuide } : {}),
  }

  if (set.flashcards.length === 0 && set.quiz.length === 0 && set.summary.points.length === 0) {
    return null
  }
  return set
}
