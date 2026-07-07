/**
 * quiz-stage-ui.ts — pure presentation logic for the staged quiz sub-view:
 * difficulty "heat" (visual escalation of difícil by boost), the between-stage
 * result tier, and the actionable advice line built from the most-failed topics.
 * Pure → unit-testable; the component keeps only rendering + state.
 */

import type { StudyDifficulty } from "@/lib/api"

/**
 * Visual "heat" for the difficulty indicator. Difícil escalates by boost: a base
 * difícil reads elegant orange, and a boosted (very hard) difícil turns red — both
 * are still the difícil stage, the colour just signals how demanding it has become.
 */
export type Heat = "base" | "warn" | "hot"

export function heatFor(difficulty: StudyDifficulty, boost: number): Heat {
  if (difficulty !== "dificil") return "base"
  return boost >= 2 ? "hot" : "warn"
}

export interface StageTier {
  emoji: string
  head: string
}

/** Between-stage result tier from the stage's accuracy (0..1). */
export function stageTier(accuracy: number): StageTier {
  if (accuracy >= 0.9) return { emoji: "🎯", head: "Dominio sólido" }
  if (accuracy >= 0.7) return { emoji: "💪", head: "Buen ritmo" }
  return { emoji: "📚", head: "A reforzar" }
}

/** Most-failed topics first (ties keep insertion order), capped at `limit`. */
export function topMissedTopics(tally: Map<string, number>, limit = 3): string[] {
  return [...tally.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([topic]) => topic)
    .slice(0, limit)
}

/**
 * Advice keyed on WHAT was missed: name the most-failed topics so the tip is
 * actionable, not a generic accuracy message. Falls back when topics are absent.
 */
export function stageAdvice(failed: number, topMissed: string[]): string {
  if (failed === 0) return "Etapa perfecta, sin fallos. Vas listo para subir el nivel."
  if (topMissed.length > 0)
    return `Consejo: refuerza ${topMissed.join(", ")} — esas preguntas pasaron a tu Repaso. Domínalas antes de avanzar.`
  return "Consejo: vuelve a tu Repaso y reintenta las preguntas falladas hasta dominarlas."
}
