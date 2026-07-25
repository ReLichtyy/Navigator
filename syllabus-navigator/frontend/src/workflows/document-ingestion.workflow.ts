import { ArtifactRunRepository } from "@/lib/server/repositories/artifact-run.repo"
import type { DocumentIngestionDispatch } from "@/lib/server/services/artifact-dispatch.service"

async function drainDocumentStep(payload: DocumentIngestionDispatch): Promise<void> {
  "use step"
  const startedAt = Date.now()
  await ArtifactRunRepository.setProgress(payload.runId, "extracting", 15)
  const { DocumentRepository } = await import("@/lib/server/repositories/document.repo")
  const document = await DocumentRepository.findById(payload.syllabusId)
  try {
    if (document?.status === "needs_ocr") {
      const { OcrService } = await import("@/lib/server/services/ocr.service")
      await OcrService.extractScannedPdf(payload.syllabusId)
    }
    await ArtifactRunRepository.setProgress(payload.runId, "inventory", 40)
    const { IngestionService } = await import("@/lib/server/services/ingestion.service")
    const result = await IngestionService.drainForSyllabus(payload.syllabusId)
    if (result.processed === 0 && result.retried === 0) {
      throw new Error(`No pending ingestion job found for ${payload.syllabusId}`)
    }
    if (result.failed > 0) {
      throw new Error(`Ingestion failed for ${payload.syllabusId}`)
    }
    await ArtifactRunRepository.recordStep(payload.runId, {
      step: "document_ingestion",
      status: "completed",
      model: process.env.MODEL_RAG?.trim() || "gpt-5-mini",
      latencyMs: Date.now() - startedAt,
    })
  } catch (error) {
    await ArtifactRunRepository.recordStep(payload.runId, {
      step: "document_ingestion",
      status: "failed",
      model: process.env.MODEL_RAG?.trim() || "gpt-5-mini",
      latencyMs: Date.now() - startedAt,
      failureReason: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

async function settleDocumentRun(
  runId: string,
  status: "completed" | "failed",
  error: string | null = null,
): Promise<void> {
  "use step"
  await ArtifactRunRepository.settle(runId, status, error, status === "failed")
}

export async function documentIngestionWorkflow(payload: DocumentIngestionDispatch): Promise<void> {
  "use workflow"
  try {
    await drainDocumentStep(payload)
    await settleDocumentRun(payload.runId, "completed")
  } catch (error) {
    await settleDocumentRun(
      payload.runId,
      "failed",
      error instanceof Error ? error.message : String(error),
    )
    throw error
  }
}
