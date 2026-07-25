import { ArtifactRunRepository } from "../repositories/artifact-run.repo"
import { JobRepository } from "../repositories/job.repo"
import { logError, logInfo } from "@/lib/observability/logger"
import type { CourseGraphDispatch } from "./artifact-dispatch.service"

const COURSE_GRAPH_JOB = "artifact-course-graph"

/** Transitional consumer used only while the durable workflow flags are off. */
export const ArtifactQueueService = {
  async drainCourseGraphs(maxJobs = 2): Promise<{
    processed: number
    failed: number
    retried: number
  }> {
    const tally = { processed: 0, failed: 0, retried: 0 }
    for (let index = 0; index < maxJobs; index++) {
      const job = await JobRepository.claimNext(COURSE_GRAPH_JOB)
      if (!job) break
      const payload = job.payload as unknown as CourseGraphDispatch
      if (!payload.runId || !payload.userId || !payload.courseId || !payload.input?.fileIds) {
        await JobRepository.fail(job.id, "Invalid course graph artifact payload", true)
        tally.failed++
        continue
      }
      try {
        const { CourseGraphService } = await import("./course-graph.service")
        if (payload.input.branchId) {
          await CourseGraphService.refineBranch(
            payload.userId,
            payload.courseId,
            payload.input,
            payload.runId,
          )
        } else {
          await CourseGraphService.regenerate(
            payload.userId,
            payload.courseId,
            payload.input,
            payload.runId,
          )
        }
        await ArtifactRunRepository.settle(payload.runId, "completed")
        await JobRepository.complete(job.id, { runId: payload.runId })
        tally.processed++
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const result = await JobRepository.fail(job.id, message)
        if (result.retried) tally.retried++
        else {
          await ArtifactRunRepository.settle(payload.runId, "failed", message, true)
          tally.failed++
        }
        logError("artifact_queue.course_graph_failed", { runId: payload.runId, error: message })
      }
    }
    if (tally.processed || tally.failed || tally.retried) {
      logInfo("artifact_queue.course_graph_drain", tally)
    }
    return tally
  },
}
