import { JobRepository } from "../repositories/job.repo"

export interface CourseGraphDispatch {
  runId: string
  userId: string
  courseId: string
  input: { fileIds: string[]; focusTopics?: string[]; instructions?: string }
}

/**
 * Dispatch boundary for artifact work. The DB queue is the safe fallback and
 * remains useful for local development; the Vercel Workflow adapter replaces
 * this implementation when KNOWLEDGE_PIPELINE_V2 is enabled in production.
 */
export const ArtifactDispatchService = {
  async dispatchCourseGraph(payload: CourseGraphDispatch): Promise<string> {
    return JobRepository.enqueue("artifact-course-graph", payload as unknown as Record<string, unknown>, {
      dedupeKey: payload.runId,
    })
  },
}
