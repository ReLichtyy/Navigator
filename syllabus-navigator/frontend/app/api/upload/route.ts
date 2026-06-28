import { NextResponse } from "next/server"
import { requireAuth, requireRateLimit, ApiErrorResponse } from "@/lib/server/utils/auth-helpers"
import { DocumentService } from "@/lib/server/services/document.service"
import { IngestionService } from "@/lib/server/services/ingestion.service"
import { logError, logInfo } from "@/lib/observability/logger"
import { invalidatePrefix } from "@/lib/cache"

export const dynamic = "force-dynamic"
export const maxDuration = 60 // embeddings run inline (graph/schedule via /process)

export async function POST(request: Request) {
  try {
    // Guests may upload too — their upload is ephemeral (24h, no blob). See document.service.
    const { userId, role } = await requireAuth()

    await requireRateLimit(userId, role)

    const formData = await request.formData().catch(() => null)
    if (!formData) {
      return NextResponse.json({ error: "No form data provided." }, { status: 400 })
    }

    const file = formData.get("file") as File | null
    if (!file) {
      return NextResponse.json({ error: "No file provided." }, { status: 400 })
    }

    const upload = await DocumentService.processUpload(userId, role, file)

    // Scanned PDF (no digital text): persisted but not indexed. Skip the worker.
    if (upload.status === "needs_ocr") {
      await invalidatePrefix(`uploads:list:${userId}`)
      logInfo("api.upload.needs_ocr", { userId, uploadId: upload.id })
      return NextResponse.json(
        {
          syllabus_id: upload.id,
          status: "needs_ocr",
          message:
            "No pudimos indexar este PDF porque parece ser un documento escaneado o sin " +
            "texto digital seleccionable. El OCR automático no está habilitado. El archivo " +
            "sí quedó guardado, pero está pendiente de OCR o de una versión con texto digital.",
        },
        { status: 200 },
      )
    }

    // Embed inline (fast) so the file is chat-ready immediately and the request
    // returns well under the serverless cap; the slow graph/schedule/inference run
    // via the client-fired /process call afterwards (the UI polls graph_status).
    await IngestionService.embedOnly(upload.id)
    await invalidatePrefix(`uploads:list:${userId}`)

    logInfo("api.upload.success", {
      userId,
      uploadId: upload.id,
      filename: upload.original_filename,
    })

    return NextResponse.json(
      {
        syllabus_id: upload.id,
        status: "processed",
        message: "File uploaded and processed.",
      },
      { status: 201 },
    )
  } catch (err) {
    if (err instanceof ApiErrorResponse) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }

    logError("api.upload.error", {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: "Failed to upload file." }, { status: 500 })
  }
}
