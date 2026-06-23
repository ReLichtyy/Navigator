/**
 * StudyService — serve per-course study material for the "Área de Estudio" window.
 *
 * Ownership is enforced via DocumentRepository.findByIdAndUser (same as GraphService).
 * The set is generated from the course chunks once and cached in `study_sets`;
 * `refresh` regenerates and re-caches it.
 */

import { DocumentRepository } from "../repositories/document.repo"
import { ChunkRepository } from "../repositories/chunk.repo"
import { StudyRepository } from "../repositories/study.repo"
import { ApiErrorResponse } from "../utils/auth-helpers"
import { generateStudySet, type StudySet } from "../rag/study-gen"

export const StudyService = {
  /**
   * Get the study set for a syllabus the caller owns.
   * - cached set returned as-is unless `refresh` is set,
   * - 404 when the syllabus is not owned,
   * - 409 ("not ready") when the syllabus has no usable material yet.
   */
  async getStudySet(
    userId: string,
    syllabusId: string,
    opts: { refresh?: boolean } = {},
  ): Promise<StudySet> {
    const doc = await DocumentRepository.findByIdAndUser(syllabusId, userId)
    if (!doc) throw new ApiErrorResponse("Syllabus not found", 404)

    if (!opts.refresh) {
      const cached = await StudyRepository.get(syllabusId)
      if (cached) return cached
    }

    const text = await ChunkRepository.getConcatenatedText(syllabusId)
    if (!text || text.trim().length < 80) {
      throw new ApiErrorResponse(
        "This course doesn't have enough indexed material yet. Try again once processing finishes.",
        409,
      )
    }

    const set = await generateStudySet(text)
    if (!set) {
      throw new ApiErrorResponse("Could not generate study material from this course.", 409)
    }

    await StudyRepository.upsert(syllabusId, set)
    return set
  },
}
