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
import { GraphRepository } from "../repositories/graph.repo"
import { ApiErrorResponse } from "../utils/auth-helpers"
import { generateStudySet, type StudySet, type Difficulty } from "../rag/study-gen"

export const StudyService = {
  /**
   * Get the study set for a syllabus the caller owns.
   * - the default (medium, whole-course) set is cached in `study_sets`,
   * - a custom set (non-medium difficulty OR a specific topic) is generated
   *   fresh and NOT cached, so it never clobbers the default,
   * - cached set returned as-is unless `refresh` is set,
   * - 404 when the syllabus is not owned,
   * - 409 ("not ready") when the syllabus has no usable material yet.
   */
  async getStudySet(
    userId: string,
    syllabusId: string,
    opts: { refresh?: boolean; difficulty?: Difficulty; topic?: string } = {},
  ): Promise<StudySet> {
    const doc = await DocumentRepository.findByIdAndUser(syllabusId, userId)
    if (!doc) throw new ApiErrorResponse("Syllabus not found", 404)

    const topic = opts.topic?.trim() || undefined
    const difficulty = opts.difficulty ?? "medio"
    const custom = !!topic || difficulty !== "medio"

    // Default set is cacheable; custom (topic/difficulty) sets are always fresh.
    if (!opts.refresh && !custom) {
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

    // Bias generation toward the course's heaviest (most exam-weighted) topics.
    const { topics } = await GraphRepository.getGraph(syllabusId)
    const weightedTopics = topics
      .filter((t) => (t.weight_percent ?? 0) > 0)
      .map((t) => ({ label: t.label, weight: Number(t.weight_percent) }))

    const set = await generateStudySet(text, { difficulty, topic, weightedTopics })
    if (!set) {
      throw new ApiErrorResponse("Could not generate study material from this course.", 409)
    }

    // Only persist the canonical default set.
    if (!custom) await StudyRepository.upsert(syllabusId, set)
    return set
  },
}
