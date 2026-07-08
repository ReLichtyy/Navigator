/**
 * orchestrator/runner.ts — the Study Engine generation graph.
 *
 * Replaces the single mega-call (study-gen.generateStudySet) with specialized
 * agents run in parallel, then an answer-correctness gate over the quiz:
 *
 *   evidence → ┬→ flashcardAgent  ┐
 *              ├→ inquisitorAgent ┼→ gateQuiz (batched critic) → assemble StudySet
 *              ├→ synthAgent      ┤
 *              └→ mindmapAgent    ┘
 *
 * Agents fail soft (return [] / null), so a partial set still serves. Returns
 * null only when nothing usable was produced (same contract as generateStudySet).
 */
import { flashcardAgent } from "../agents/flashcard"
import { inquisitorAgent } from "../agents/inquisitor"
import { synthAgent } from "../agents/synth"
import { mindmapAgent } from "../agents/mindmap"
import { gateQuiz, gateFlashcards } from "../eval/gates"
import type { StudySet, StudyGenOptions } from "../study-gen"

export interface OrchestrateParts {
  /** Generate + gate the quiz. Off for the menu set (quiz is served by the staged endpoint). */
  quiz?: boolean
}

export async function orchestrateStudySet(
  evidence: string,
  opts: StudyGenOptions = {},
  parts: OrchestrateParts = {},
): Promise<StudySet | null> {
  const text = evidence.trim()
  if (text.length < 80) return null
  const withQuiz = parts.quiz ?? true
  const mindMode = opts.mindMode ?? "radial"

  // Generate the artifact families in parallel (quiz only when requested).
  const [rawFlash, rawQuiz, synth, mindmapOut] = await Promise.all([
    flashcardAgent(text, opts),
    withQuiz ? inquisitorAgent(text, opts) : Promise.resolve([]),
    synthAgent(text, opts),
    mindmapAgent(text, mindMode, opts),
  ])

  // Quality gates: flashcards (grounded + substantive + accurate) and, when built,
  // the quiz (sound + grounded + substantive). Both drop "floja" items at the root.
  const [flashcards, quiz] = await Promise.all([
    gateFlashcards(rawFlash, text),
    withQuiz ? gateQuiz(rawQuiz, text) : Promise.resolve([]),
  ])

  const summary = synth?.summary ?? {
    titulo: "",
    temaPrincipal: "",
    introduccion: "",
    ideasPrincipales: [],
    conceptos: [],
    conclusion: "",
  }
  const mindmap = mindmapOut ?? { mode: mindMode, center: "", branches: [] }

  const set: StudySet = {
    flashcards,
    quiz,
    summary,
    mindmap,
    ...(synth?.studyGuide && synth.studyGuide.length > 0 ? { studyGuide: synth.studyGuide } : {}),
  }

  if (
    set.flashcards.length === 0 &&
    set.quiz.length === 0 &&
    set.summary.ideasPrincipales.length === 0
  ) {
    return null
  }
  return set
}
