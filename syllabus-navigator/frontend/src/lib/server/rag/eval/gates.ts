/**
 * eval/gates.ts — quality gates applied before items are served/persisted.
 *
 * Step 4: the answer-correctness gate runs the verifier (a different model family
 * than the inquisitor) over each quiz question and drops the ones it refutes.
 * Drops are logged — no silent caps, so coverage isn't faked. Other gates
 * (faithfulness, novelty/dedup) live elsewhere: dedup is the bank's embedding
 * gate (study-items.repo), groundedness is enforced by the agents' prompts.
 */
import { verifyQuestion } from "../agents/verifier"
import type { QuizQuestion } from "../study-gen"
import { logInfo } from "@/lib/observability/logger"

/**
 * Answer-correctness gate: keep questions the verifier confirms. A question the
 * verifier explicitly refutes is dropped. If the verifier itself fails (null),
 * the question is kept — infra failure must not silently shrink the quiz.
 */
export async function verifyQuiz(quiz: QuizQuestion[], evidence: string): Promise<QuizQuestion[]> {
  if (quiz.length === 0) return quiz
  const verdicts = await Promise.all(quiz.map((q) => verifyQuestion(q, evidence)))
  const kept = quiz.filter((_, i) => {
    const v = verdicts[i]
    return v === null ? true : v.ok
  })
  const dropped = quiz.length - kept.length
  if (dropped > 0) logInfo("rag.eval.quiz_dropped", { dropped, total: quiz.length })
  return kept
}
