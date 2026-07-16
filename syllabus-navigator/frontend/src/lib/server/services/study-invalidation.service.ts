import { DocumentRepository } from "../repositories/document.repo"
import { CourseGraphRepository } from "../repositories/course-graph.repo"
import { StudyScopeRepository } from "../repositories/study-scope.repo"
import { logError, logInfo } from "@/lib/observability/logger"

/** Coordinates cross-feature cache invalidation after graph/content mutations. */
export const StudyInvalidationService = {
  async invalidateDocumentGraph(userId: string, syllabusId: string): Promise<void> {
    try {
      const doc = await DocumentRepository.findByIdAndUser(syllabusId, userId)
      if (!doc) return

      await StudyScopeRepository.purgeGenerated({ kind: "doc", id: syllabusId })
      if (doc.course_id) {
        await Promise.all([
          StudyScopeRepository.purgeGenerated({ kind: "course", id: doc.course_id }),
          CourseGraphRepository.markStale(doc.course_id),
        ])
      }
      logInfo("study.invalidated.document_graph", {
        syllabusId,
        courseId: doc.course_id ?? null,
      })
    } catch (error) {
      logError("study.invalidate_document_graph_failed", {
        syllabusId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  },

  async invalidateCourseGraph(courseId: string): Promise<void> {
    try {
      await StudyScopeRepository.purgeGenerated({ kind: "course", id: courseId })
      logInfo("study.invalidated.course_graph", { courseId })
    } catch (error) {
      logError("study.invalidate_course_graph_failed", {
        courseId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  },
}
