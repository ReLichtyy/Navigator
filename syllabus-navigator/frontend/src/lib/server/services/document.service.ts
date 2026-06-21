import { DocumentRepository } from "../repositories/document.repo"
import { ChunkRepository } from "../repositories/chunk.repo"
import { JobRepository } from "../repositories/job.repo"
import { ApiErrorResponse } from "../utils/auth-helpers"
import { pdfToPageChunks } from "../rag/chunking"
import { storePdf } from "../storage/blob"
import { logInfo } from "@/lib/observability/logger"
import type { Role } from "@/lib/auth/rbac"
import crypto from "crypto"

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB
const GUEST_TTL_HOURS = 24

export const DocumentService = {
  /**
   * Phase 1 of ingestion (synchronous, in the request):
   *   validate → parse PDF text → chunk → persist chunk text → enqueue embed job.
   *
   * Accounts: PDF is stored in blob (file_url, persistent).
   * Guests: PDF is NOT stored; the upload is ephemeral (expires_at = now + 24h).
   *
   * Returns the new upload id and the enqueued job id (for fire-and-forget trigger).
   */
  async processUpload(
    userId: string,
    role: Role,
    file: File,
  ): Promise<{ id: string; original_filename: string; jobId: string }> {
    if (file.type !== "application/pdf") {
      throw new ApiErrorResponse("Only PDF files are allowed.", 400)
    }
    if (file.size > MAX_FILE_SIZE) {
      throw new ApiErrorResponse(
        `File size exceeds the 5MB limit. (Got ${(file.size / 1024 / 1024).toFixed(2)}MB)`,
        400,
      )
    }

    const bytes = new Uint8Array(await file.arrayBuffer())
    const sourceHash = crypto.createHash("sha256").update(bytes).digest("hex")

    // Parse + chunk now (fast, no network) so the async worker never needs the raw PDF.
    const chunks = await pdfToPageChunks(bytes)
    if (chunks.length === 0) {
      throw new ApiErrorResponse("No text could be extracted from this PDF.", 422)
    }

    const isGuest = role === "guest"
    const fileUrl = isGuest ? null : await storePdf(userId, file.name, bytes)
    const expiresAt = isGuest
      ? new Date(Date.now() + GUEST_TTL_HOURS * 3600 * 1000).toISOString()
      : null

    const upload = await DocumentRepository.createUpload(userId, file.name, sourceHash, {
      fileUrl,
      expiresAt,
    })

    await ChunkRepository.replaceChunksText(upload.id, chunks)
    const jobId = await JobRepository.enqueue("ingest", { syllabusId: upload.id })

    logInfo("document.upload.phase1", {
      userId,
      isGuest,
      uploadId: upload.id,
      chunks: chunks.length,
      stored: Boolean(fileUrl),
    })

    return { ...upload, jobId }
  },
}
