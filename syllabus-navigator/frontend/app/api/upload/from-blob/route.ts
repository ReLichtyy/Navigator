import { NextResponse } from "next/server"
import { requireAuth, requireRateLimit, ApiErrorResponse } from "@/lib/server/utils/auth-helpers"
import { DocumentService } from "@/lib/server/services/document.service"
import { UploadFromBlobSchema } from "@/lib/server/validators/api.schemas"
import { logError, logInfo } from "@/lib/observability/logger"
import { invalidatePrefix } from "@/lib/cache"
import { KnowledgePipelineService } from "@/lib/server/services/knowledge-pipeline.service"

export const dynamic = "force-dynamic"
export const maxDuration = 60

/**
 * Ingest a file the client already uploaded to Vercel Blob (see /api/upload/blob).
 * Only the small JSON {url, filename, contentType} crosses the function boundary,
 * so this never hits the serverless body limit regardless of file size.
 */
export async function POST(request: Request) {
  try {
    const { userId, role } = await requireAuth()
    await requireRateLimit(userId, role)

    const body = await request.json().catch(() => null)
    const parsed = UploadFromBlobSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Datos inválidos." },
        { status: 400 },
      )
    }

    const upload = await DocumentService.processUploadFromBlob(userId, role, parsed.data)
    const generation = await KnowledgePipelineService.enqueueDocument(userId, upload.id).catch(
      (error) => {
        logError("api.upload.from_blob.workflow_start_error", {
          uploadId: upload.id,
          error: error instanceof Error ? error.message : String(error),
        })
        return null
      },
    )

    if (upload.status === "needs_ocr") {
      await invalidatePrefix(`uploads:list:${userId}`)
      logInfo("api.upload.from_blob.needs_ocr", { userId, uploadId: upload.id })
      return NextResponse.json(
        {
          syllabus_id: upload.id,
          status: "needs_ocr",
          generation,
          message: "Este PDF parece escaneado. El OCR automático ya quedó en cola.",
        },
        { status: 200 },
      )
    }

    await invalidatePrefix(`uploads:list:${userId}`)

    logInfo("api.upload.from_blob.success", { userId, uploadId: upload.id })

    return NextResponse.json(
      {
        syllabus_id: upload.id,
        status: "pending",
        generation,
        message: "File uploaded; processing started.",
      },
      { status: 201 },
    )
  } catch (err) {
    if (err instanceof ApiErrorResponse) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    logError("api.upload.from_blob.error", {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: "Failed to process file." }, { status: 500 })
  }
}
