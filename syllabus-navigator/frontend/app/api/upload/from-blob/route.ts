import { NextResponse } from "next/server"
import { requireAuth, requireRateLimit, ApiErrorResponse } from "@/lib/server/utils/auth-helpers"
import { DocumentService } from "@/lib/server/services/document.service"
import { IngestionService } from "@/lib/server/services/ingestion.service"
import { UploadFromBlobSchema } from "@/lib/server/validators/api.schemas"
import { logError, logInfo } from "@/lib/observability/logger"
import { invalidatePrefix } from "@/lib/cache"

export const dynamic = "force-dynamic"
export const maxDuration = 60 // embeddings run inline (graph/schedule via /process)

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

    if (upload.status === "needs_ocr") {
      await invalidatePrefix(`uploads:list:${userId}`)
      logInfo("api.upload.from_blob.needs_ocr", { userId, uploadId: upload.id })
      return NextResponse.json(
        {
          syllabus_id: upload.id,
          status: "needs_ocr",
          message:
            "No pudimos indexar este PDF porque parece ser un documento escaneado o sin " +
            "texto digital seleccionable. El archivo sí quedó guardado.",
        },
        { status: 200 },
      )
    }

    // Embed inline (fast) so the file is chat-ready immediately; the slow
    // graph/schedule/inference run via the client-fired /process call afterwards.
    await IngestionService.embedOnly(upload.id)
    await invalidatePrefix(`uploads:list:${userId}`)

    logInfo("api.upload.from_blob.success", { userId, uploadId: upload.id })

    return NextResponse.json(
      { syllabus_id: upload.id, status: "processed", message: "File uploaded and processed." },
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
