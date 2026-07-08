/**
 * server/services/course.service.ts — Course Intelligence Layer business logic.
 *
 *   inferForDocument()  ← called by the ingestion worker (best-effort, accounts only)
 *   confirm/reject/skip ← called by the API after the user acts on a suggestion
 *   list/create         ← user course management
 *
 * Documents live in `syllabus_uploads`; courses in `user_courses`. A document's
 * course_id is ONLY set after the user confirms (see confirm()).
 */

import { CourseRepository, type CreateCourseInput } from "../repositories/course.repo"
import { CourseSuggestionRepository } from "../repositories/course-suggestion.repo"
import { DocumentRepository } from "../repositories/document.repo"
import { inferCourse } from "../rag/course-infer"
import { delBlob } from "../storage/blob"
import { ApiErrorResponse } from "../utils/auth-helpers"
import { logInfo } from "@/lib/observability/logger"

export const CourseService = {
  /**
   * Infer a course for a freshly-ingested document and record the suggestion.
   * Best-effort: callers (the worker) swallow errors. Skips guests (ephemeral
   * uploads have expires_at set) — inference is for real accounts only.
   */
  async inferForDocument(syllabusId: string, text: string): Promise<void> {
    const doc = await DocumentRepository.findById(syllabusId)
    if (!doc) return
    if (doc.expires_at) return // guest upload → no course inference
    // Don't clobber a choice the user already made.
    if (doc.infer_status === "confirmed" || doc.infer_status === "skipped") return

    const existing = await CourseRepository.listByUser(doc.user_id)
    const inf = await inferCourse(
      doc.original_filename,
      text,
      existing.map((c) => ({ id: c.id, name: c.name, subject_tags: c.subject_tags })),
    )

    await CourseSuggestionRepository.create({
      documentId: syllabusId,
      suggestedCourseId: inf.matchedCourseId,
      suggestedName: inf.suggestedName,
      confidence: inf.confidence,
      method: inf.method,
      termStart: inf.termStart,
    })
    await DocumentRepository.setInference(
      syllabusId,
      inf.suggestedName,
      inf.confidence,
      "suggested",
    )

    logInfo("course.inferred", {
      syllabusId,
      matched: Boolean(inf.matchedCourseId),
      confidence: inf.confidence,
    })
  },

  async listCourses(userId: string) {
    return CourseRepository.listByUser(userId)
  },

  async createCourse(userId: string, input: CreateCourseInput) {
    return CourseRepository.createOrGet(userId, input)
  },

  /** Rename and/or set the term start (anchor to resolve "Semana N" → dates). */
  async updateCourse(
    courseId: string,
    userId: string,
    patch: { name?: string; termStart?: string | null },
  ) {
    const updated = await CourseRepository.update(courseId, userId, patch)
    if (!updated) throw new ApiErrorResponse("Course not found.", 404)
    return updated
  },

  /**
   * Delete a course AND its documents (cascade). The documents' dependent rows
   * (chunks, topics, schedule, study material) follow via their own FKs. The
   * UI warns before calling this — it is irreversible.
   */
  async deleteCourse(courseId: string, userId: string) {
    // Ownership check first so an unowned id can't delete anything.
    const course = await CourseRepository.findByIdAndUser(courseId, userId)
    if (!course) throw new ApiErrorResponse("Course not found.", 404)
    const { count, fileUrls } = await DocumentRepository.deleteByCourse(courseId, userId)
    await CourseRepository.deleteByIdAndUser(courseId, userId)
    // Stored files go too (best-effort: a failure only leaves orphan blobs).
    await Promise.all(fileUrls.map((url) => delBlob(url)))
    logInfo("course.deleted_cascade", { courseId, removedDocs: count, removedBlobs: fileUrls.length })
  },

  /**
   * Confirm a document's course. Resolution order:
   *   1. newCourse.name → create (or reuse) that course
   *   2. courseId       → assign an existing, owned course
   *   3. neither        → accept the standing suggestion (matched course, or a
   *                       new course built from the inferred name)
   */
  async confirm(
    docId: string,
    userId: string,
    opts: {
      courseId?: string
      newCourse?: { name: string; subjectTags?: string[]; color?: string }
    },
  ) {
    let courseId: string
    const suggestion = await CourseSuggestionRepository.latestForDocument(docId)

    if (opts.newCourse?.name?.trim()) {
      const created = await CourseRepository.createOrGet(userId, {
        name: opts.newCourse.name.trim(),
        subjectTags: opts.newCourse.subjectTags ?? null,
        color: opts.newCourse.color ?? null,
      })
      courseId = created.id
    } else if (opts.courseId) {
      const course = await CourseRepository.findByIdAndUser(opts.courseId, userId)
      if (!course) throw new ApiErrorResponse("Course not found.", 404)
      courseId = course.id
    } else {
      if (!suggestion) throw new ApiErrorResponse("No suggestion to confirm.", 409)
      if (suggestion.suggested_course_id) {
        courseId = suggestion.suggested_course_id
      } else {
        const created = await CourseRepository.createOrGet(userId, {
          name: suggestion.suggested_name,
        })
        courseId = created.id
      }
    }

    const updated = await DocumentRepository.assignCourse(docId, userId, courseId, "confirmed")
    if (!updated) throw new ApiErrorResponse("Document not found.", 404)
    await CourseSuggestionRepository.resolve(docId, true)

    // Term start inferred from the syllabus itself: apply it only now (course
    // confirmed) and only if the course has none — a user-set value always wins.
    if (suggestion?.term_start) {
      const course = await CourseRepository.findByIdAndUser(courseId, userId)
      if (course && !course.term_start) {
        await CourseRepository.update(courseId, userId, { termStart: suggestion.term_start })
        logInfo("course.term_start_inferred", { courseId, termStart: suggestion.term_start })
      }
    }

    logInfo("course.confirmed", { docId, userId, courseId })
    return updated
  },

  /** Reject the suggestion: leave the document without a course. */
  async reject(docId: string, userId: string) {
    const updated = await DocumentRepository.assignCourse(docId, userId, null, "rejected")
    if (!updated) throw new ApiErrorResponse("Document not found.", 404)
    await CourseSuggestionRepository.resolve(docId, false)
    return updated
  },

  /** Defer the decision: keep the document uncategorised for now. */
  async skip(docId: string, userId: string) {
    const updated = await DocumentRepository.assignCourse(docId, userId, null, "skipped")
    if (!updated) throw new ApiErrorResponse("Document not found.", 404)
    return updated
  },
}
