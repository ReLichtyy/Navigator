import { JobRepository } from "../repositories/job.repo"
import { flags } from "@/lib/config/flags"
import { start } from "workflow/api"
import { generateCourseGraphWorkflow } from "@/workflows/course-graph.workflow"
import { documentIngestionWorkflow } from "@/workflows/document-ingestion.workflow"

export interface CourseGraphDispatch {
  runId: string
  userId: string
  courseId: string
  input: {
    fileIds: string[]
    focusTopics?: string[]
    instructions?: string
    branchId?: string
    branchMode?: "regenerate" | "expand" | "condense"
  }
}

export interface DocumentIngestionDispatch {
  runId: string
  userId: string
  syllabusId: string
}

/**
 * Dispatch boundary for artifact work. The DB queue is the safe fallback and
 * remains useful for local development; the Vercel Workflow adapter replaces
 * this implementation when KNOWLEDGE_PIPELINE_V2 is enabled in production.
 */
export const ArtifactDispatchService = {
  async dispatchIngestion(payload: DocumentIngestionDispatch): Promise<string> {
    if (flags.knowledgePipelineV2) {
      const run = await start(documentIngestionWorkflow, [payload])
      return run.runId
    }
    return JobRepository.enqueue(
      "ingest",
      { syllabusId: payload.syllabusId, artifactRunId: payload.runId },
      { kickIfPending: true },
    )
  },

  async dispatchCourseGraph(payload: CourseGraphDispatch): Promise<string> {
    if (flags.knowledgePipelineV2 && flags.graphPipelineV2) {
      const run = await start(generateCourseGraphWorkflow, [payload])
      return run.runId
    }
    return JobRepository.enqueue(
      "artifact-course-graph",
      { ...payload, dedupeKey: payload.runId } as unknown as Record<string, unknown>,
      { dedupeKey: payload.runId },
    )
  },
}
