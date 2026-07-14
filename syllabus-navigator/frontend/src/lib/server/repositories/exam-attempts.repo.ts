/**
 * exam-attempts.repo.ts — persistence for the Examen mode.
 *
 * Stores the paper AS SERVED (options already shuffled, hidden fields — answer
 * index, expectedAnswer, rubric, modelSolution — intact) so grading compares
 * the student's responses against exactly what they saw. `status` implements
 * submit-once: 'graded' attempts return their stored result idempotently.
 */
import { sql } from "@/lib/db"
import type { StudyScope } from "./study-items.repo"

export interface DbExamAttempt {
  id: string
  user_id: string
  scope_kind: "doc" | "course"
  scope_id: string
  template: string
  status: "in_progress" | "graded"
  paper: unknown
  result: unknown | null
  score: string | null
  max_score: string
  started_at: string
  graded_at: string | null
}

export const ExamAttemptsRepository = {
  async create(
    userId: string,
    scope: StudyScope,
    template: string,
    paper: unknown,
    maxScore: number,
  ): Promise<{ id: string; started_at: string }> {
    const rows = await sql`
      INSERT INTO exam_attempts (user_id, scope_kind, scope_id, template, paper, max_score)
      VALUES (
        ${userId}::uuid, ${scope.kind}, ${scope.id}::uuid, ${template},
        ${JSON.stringify(paper)}::jsonb, ${maxScore}
      )
      RETURNING id, started_at
    `
    return rows[0] as { id: string; started_at: string }
  },

  async findByIdAndUser(attemptId: string, userId: string): Promise<DbExamAttempt | undefined> {
    const rows = await sql`
      SELECT * FROM exam_attempts
      WHERE id = ${attemptId}::uuid AND user_id = ${userId}::uuid
    `
    return rows[0] as DbExamAttempt | undefined
  },

  async markGraded(
    attemptId: string,
    result: unknown,
    score: number,
    maxScore: number,
  ): Promise<void> {
    await sql`
      UPDATE exam_attempts SET
        status    = 'graded',
        result    = ${JSON.stringify(result)}::jsonb,
        score     = ${score},
        max_score = ${maxScore},
        graded_at = now()
      WHERE id = ${attemptId}::uuid
    `
  },
}
