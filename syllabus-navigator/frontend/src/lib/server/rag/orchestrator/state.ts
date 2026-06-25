/**
 * orchestrator/state.ts — shared types for the Study Engine orchestration graph.
 *
 * The orchestration is a directed graph: plan → retrieve → [agents in parallel]
 * → verify (gates) → assemble. State is threaded explicitly so each step is pure
 * and testable. runner.ts realizes the study graph; router.ts builds the plan.
 */
import type { Difficulty } from "../study-gen"

/** One topic the plan wants covered, with the signals that set its priority. */
export interface TopicTarget {
  label: string
  topicKey: string
  weightExam: number // 0..100
  mastery: number // 0..1 (1 = mastered) — lower ⇒ needs more practice
  priority: number // 0..1 blended score, higher = study first
}

/** The plan the router produces from (mode, scope, difficulty, student state). */
export interface StudyPlan {
  scope: { kind: "doc" | "course"; id: string }
  targets: TopicTarget[]
  difficulty: Difficulty
  /** Global spaced-repetition pressure for the scope (due/total cards), 0..1. */
  srsPressure: number
  /** Schedule urgency for the scope (nearest assessment), 0..1. */
  urgency: number
}
