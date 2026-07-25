import { ArtifactRunRepository } from "@/lib/server/repositories/artifact-run.repo"
import type { CourseGraphDispatch } from "@/lib/server/services/artifact-dispatch.service"

async function generateCourseGraphStep(payload: CourseGraphDispatch): Promise<void> {
  "use step"
  const startedAt = Date.now()
  await ArtifactRunRepository.setProgress(payload.runId, "enriching", 35)
  try {
    const { CourseGraphService } = await import("@/lib/server/services/course-graph.service")
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
    await ArtifactRunRepository.recordStep(payload.runId, {
      step: payload.input.branchId ? "branch_enrichment" : "course_graph_enrichment",
      status: "completed",
      model: process.env.MODEL_RAG?.trim() || "gpt-5-mini",
      latencyMs: Date.now() - startedAt,
    })
  } catch (error) {
    await ArtifactRunRepository.recordStep(payload.runId, {
      step: payload.input.branchId ? "branch_enrichment" : "course_graph_enrichment",
      status: "failed",
      model: process.env.MODEL_RAG?.trim() || "gpt-5-mini",
      latencyMs: Date.now() - startedAt,
      failureReason: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
  await ArtifactRunRepository.setProgress(payload.runId, "validating", 90)
}

async function completeCourseGraphStep(runId: string): Promise<void> {
  "use step"
  await ArtifactRunRepository.settle(runId, "completed")
}

async function failCourseGraphStep(runId: string, message: string): Promise<void> {
  "use step"
  await ArtifactRunRepository.settle(runId, "failed", message, true)
}

/**
 * Durable course-map generation. Vercel retries the expensive step; only after
 * those retries are exhausted does the workflow expose a recoverable failure.
 */
export async function generateCourseGraphWorkflow(payload: CourseGraphDispatch): Promise<void> {
  "use workflow"
  try {
    await generateCourseGraphStep(payload)
    await completeCourseGraphStep(payload.runId)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await failCourseGraphStep(payload.runId, message)
    throw error
  }
}
