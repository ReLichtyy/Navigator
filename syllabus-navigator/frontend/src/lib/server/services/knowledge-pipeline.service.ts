import type { ArtifactRunAPI } from "@/types/api"
import { ArtifactRunRepository } from "../repositories/artifact-run.repo"
import { DocumentRepository } from "../repositories/document.repo"
import { ApiErrorResponse } from "../utils/auth-helpers"
import { ArtifactDispatchService } from "./artifact-dispatch.service"

type DocumentArtifactType = "document_inventory" | "document_graph"

async function enqueueDocumentArtifact(
  userId: string,
  syllabusId: string,
  artifactType: DocumentArtifactType,
): Promise<ArtifactRunAPI> {
  const document = await DocumentRepository.findByIdAndUser(syllabusId, userId)
  if (!document) throw new ApiErrorResponse("Document not found", 404)
  if (document.status === "needs_ocr" && !document.file_url) {
    throw new ApiErrorResponse("OCR requires a persisted source file.", 409)
  }
  const run = await ArtifactRunRepository.create({
    userId,
    scopeKind: "doc",
    scopeId: syllabusId,
    artifactType,
    fingerprint: `${document.source_hash}:${artifactType === "document_inventory" ? "inventory" : "graph"}-v1`,
    request: { filename: document.original_filename },
  })
  if (run.workflow_run_id && !run.workflow_run_id.startsWith("starting:")) return run
  const claimed = await ArtifactRunRepository.claimDispatch(run.id)
  if (!claimed) return run
  try {
    const workflowRunId = await ArtifactDispatchService.dispatchIngestion({
      runId: run.id,
      userId,
      syllabusId,
    })
    await ArtifactRunRepository.attachWorkflowRun(run.id, workflowRunId)
    return { ...run, workflow_run_id: workflowRunId }
  } catch (error) {
    await ArtifactRunRepository.releaseDispatchClaim(run.id)
    throw error
  }
}

export const KnowledgePipelineService = {
  async enqueueDocument(userId: string, syllabusId: string): Promise<ArtifactRunAPI> {
    return enqueueDocumentArtifact(userId, syllabusId, "document_inventory")
  },

  async enqueueDocumentGraph(userId: string, syllabusId: string): Promise<ArtifactRunAPI> {
    return enqueueDocumentArtifact(userId, syllabusId, "document_graph")
  },
}
