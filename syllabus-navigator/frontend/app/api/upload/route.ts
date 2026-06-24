import { NextResponse } from "next/server"
import { requireAuth, requireRateLimit, ApiErrorResponse } from "@/lib/server/utils/auth-helpers"
import { DocumentService } from "@/lib/server/services/document.service"
import { triggerIngestionWorker } from "@/lib/server/services/worker-trigger"
import { logError, logInfo } from "@/lib/observability/logger"
import { invalidatePrefix } from "@/lib/cache"

export const dynamic = "force-dynamic"
export const maxDuration = 60 // embeddings + graph LLM run inline before responding

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

    // Run the worker (embeddings + graph) inline so it actually completes on
    // serverless, then invalidate so the list reflects the final status.
    await triggerIngestionWorker()
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
