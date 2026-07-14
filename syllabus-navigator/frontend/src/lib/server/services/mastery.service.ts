/**
 * MasteryService — topic mastery ledger (Sprint 4).
 * Records quiz outcomes against a scope the caller owns (one document OR a whole
 * course) and reads back the per-topic / per-course confidence.
 */
import {
  MasteryRepository,
  type MasteryRow,
  type CourseMastery,
} from "../repositories/mastery.repo"
import type { StudyScope } from "../repositories/study-items.repo"
import { assertScopeOwned } from "../utils/scope"

export const MasteryService = {
  async record(
    userId: string,
    scope: StudyScope,
    outcomes: { label: string; correct: boolean }[],
  ): Promise<void> {
    const s = await assertScopeOwned(userId, scope)
    if (outcomes.length === 0) return
    await MasteryRepository.recordOutcomes(userId, s, outcomes)
  },

  async forScope(userId: string, scope: StudyScope): Promise<MasteryRow[]> {
    const s = await assertScopeOwned(userId, scope)
    return MasteryRepository.listForScope(userId, s)
  },

  async overview(userId: string): Promise<CourseMastery[]> {
    return MasteryRepository.overview(userId)
  },
}
