import { NextResponse } from "next/server"
import { requireAuth, requireRateLimit, ApiErrorResponse } from "@/lib/server/utils/auth-helpers"
import { DocumentService } from "@/lib/server/services/document.service"
import { logError, logInfo } from "@/lib/observability/logger"
import { invalidatePrefix } from "@/lib/cache"
import { KnowledgePipelineService } from "@/lib/server/services/knowledge-pipeline.service"

export const dynamic = "force-dynamic"
export const maxDuration = 60

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
    const generation =
      upload.status !== "needs_ocr" || role !== "guest"
        ? await KnowledgePipelineService.enqueueDocument(userId, upload.id).catch((error) => {
            logError("api.upload.workflow_start_error", {
              uploadId: upload.id,
              error: error instanceof Error ? error.message : String(error),
            })
            return null
          })
        : null

    if (upload.status === "needs_ocr") {
      await invalidatePrefix(`uploads:list:${userId}`)
      logInfo("api.upload.needs_ocr", { userId, uploadId: upload.id })
      return NextResponse.json(
        {
          syllabus_id: upload.id,
          status: "needs_ocr",
          generation,
          message:
            role === "guest"
              ? "Este PDF necesita OCR. Inicia sesión para conservar el archivo y procesarlo."
              : "Este PDF parece escaneado. El OCR automático ya quedó en cola.",
        },
        { status: 200 },
      )
    }

    await invalidatePrefix(`uploads:list:${userId}`)

    logInfo("api.upload.success", {
      userId,
      uploadId: upload.id,
      filename: upload.original_filename,
    })

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

    logError("api.upload.error", {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: "Failed to upload file." }, { status: 500 })
  }
}
