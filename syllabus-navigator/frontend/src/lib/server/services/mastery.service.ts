/**
 * MasteryService — topic mastery ledger (Sprint 4).
 * Records quiz outcomes against a syllabus the caller owns and reads back the
 * per-topic / per-course confidence. Ownership enforced like StudyService.
 */
import { DocumentRepository } from "../repositories/document.repo"
import {
  MasteryRepository,
  type MasteryRow,
  type CourseMastery,
} from "../repositories/mastery.repo"
import { ApiErrorResponse } from "../utils/auth-helpers"

export const MasteryService = {
  async record(
    userId: string,
    syllabusId: string,
    outcomes: { label: string; correct: boolean }[],
  ): Promise<void> {
    const doc = await DocumentRepository.findByIdAndUser(syllabusId, userId)
    if (!doc) throw new ApiErrorResponse("Syllabus not found", 404)
    if (outcomes.length === 0) return
    await MasteryRepository.recordOutcomes(userId, syllabusId, outcomes)
  },

  async forSyllabus(userId: string, syllabusId: string): Promise<MasteryRow[]> {
    const doc = await DocumentRepository.findByIdAndUser(syllabusId, userId)
    if (!doc) throw new ApiErrorResponse("Syllabus not found", 404)
    return MasteryRepository.listForSyllabus(userId, syllabusId)
  },

  async overview(userId: string): Promise<CourseMastery[]> {
    return MasteryRepository.overview(userId)
  },
}
