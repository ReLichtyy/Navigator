/**
 * orchestrator/router.ts — the Router/Planner (rule-based core).
 *
 * Turns the student's state into a StudyPlan: which topics to target and in what
 * order. This is what closes the learning loop — it READS the mastery ledger,
 * the spaced-repetition pressure and the schedule (data that was previously
 * written and never read) to bias generation toward weak / urgent / heavy topics.
 *
 *   priority = w1·weightExam + w2·(1−mastery) + w3·urgency + w4·srsPressure
 *
 * Pure scoring (scoreTargets) is split out so it can be unit-tested without DB.
 */
import { MasteryRepository } from "../../repositories/mastery.repo"
import { topicKey } from "../../repositories/mastery.repo"
import { StudyStatsRepository } from "../../repositories/study-stats.repo"
import { ScheduleRepository } from "../../repositories/schedule.repo"
import { logError } from "@/lib/observability/logger"
import type { Difficulty } from "../study-gen"
import type { StudyPlan, TopicTarget } from "./state"

const W_WEIGHT = 0.3
const W_MASTERY = 0.3
const W_URGENCY = 0.25
const W_SRS = 0.15

export interface WeightedTopic {
  label: string
  weight: number
}

/** Pure priority scoring. urgency + srsPressure are scope-global scalars (0..1). */
export function scoreTargets(
  weighted: WeightedTopic[],
  masteryByKey: Map<string, number>,
  urgency: number,
  srsPressure: number,
): TopicTarget[] {
  return weighted
    .filter((t) => t.label.trim().length > 0)
    .map((t) => {
      const key = topicKey(t.label)
      const mastery = masteryByKey.get(key) ?? 0 // never practised ⇒ 0 ⇒ high priority
      const weightNorm = Math.min(Math.max(t.weight, 0), 100) / 100
      const priority =
        W_WEIGHT * weightNorm +
        W_MASTERY * (1 - mastery) +
        W_URGENCY * urgency +
        W_SRS * srsPressure
      return { label: t.label.trim(), topicKey: key, weightExam: t.weight, mastery, priority }
    })
    .sort((a, b) => b.priority - a.priority)
}

/** Days from today to the nearest future dated event → urgency in [0,1]. */
function urgencyFromSchedule(dates: (string | null)[]): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  let minDays = Infinity
  for (const d of dates) {
    if (!d) continue
    const dt = new Date(`${d}T00:00:00`)
    const days = Math.round((dt.getTime() - today.getTime()) / 86_400_000)
    if (days >= 0 && days < minDays) minDays = days
  }
  if (!isFinite(minDays)) return 0
  return Math.min(Math.max(1 - minDays / 14, 0), 1) // exam within 14 days ramps urgency up
}

/**
 * Build a StudyPlan for a syllabus. Reads mastery + SRS + schedule; degrades to
 * weight-only ordering on any failure (e.g. guest user, no graph).
 */
export async function buildStudyPlan(
  userId: string,
  syllabusId: string,
  weighted: WeightedTopic[],
  difficulty: Difficulty,
): Promise<StudyPlan> {
  let masteryByKey = new Map<string, number>()
  let urgency = 0
  let srsPressure = 0
  try {
    const [mastery, srs, events] = await Promise.all([
      MasteryRepository.listForSyllabus(userId, syllabusId),
      StudyStatsRepository.srsPressure(userId, syllabusId),
      ScheduleRepository.listBySyllabus(syllabusId),
    ])
    masteryByKey = new Map(mastery.map((m) => [m.topic_key, m.confidence]))
    srsPressure = srs.total > 0 ? srs.due / srs.total : 0
    urgency = urgencyFromSchedule(events.map((e) => e.event_date))
  } catch (err) {
    logError("rag.router.signals_error", {
      error: err instanceof Error ? err.message : String(err),
    })
  }

  return {
    scope: { kind: "doc", id: syllabusId },
    targets: scoreTargets(weighted, masteryByKey, urgency, srsPressure),
    difficulty,
    srsPressure,
    urgency,
  }
}

/** Topic labels ordered by plan priority (study-first). */
export function orderLabelsByPlan(plan: StudyPlan): string[] {
  return plan.targets.map((t) => t.label)
}
