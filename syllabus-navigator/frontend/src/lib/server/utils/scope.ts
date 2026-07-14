/**
 * server/utils/scope.ts — ownership gate for a study scope.
 *
 * A StudyScope is either one document or one whole course. Everything in the study
 * area (sets, quiz bank, Repaso, mastery, SRS) is keyed by it, so every service
 * that touches those tables goes through here first.
 */
import { DocumentRepository } from "../repositories/document.repo"
import { CourseRepository } from "../repositories/course.repo"
import type { StudyScope } from "../repositories/study-items.repo"
import { ApiErrorResponse } from "./auth-helpers"

/** Verify the caller owns the doc/course behind a scope; returns the scope or throws 404. */
export async function assertScopeOwned(userId: string, scope: StudyScope): Promise<StudyScope> {
  if (scope.kind === "doc") {
    const doc = await DocumentRepository.findByIdAndUser(scope.id, userId)
    if (!doc) throw new ApiErrorResponse("Syllabus not found", 404)
    return scope
  }
  const course = await CourseRepository.findByIdAndUser(scope.id, userId)
  if (!course) throw new ApiErrorResponse("Course not found", 404)
  return scope
}
