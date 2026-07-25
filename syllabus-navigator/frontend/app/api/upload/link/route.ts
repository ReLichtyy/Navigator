import { NextResponse } from "next/server"
import { requireAuth, requireRateLimit, ApiErrorResponse } from "@/lib/server/utils/auth-helpers"
import { DocumentService } from "@/lib/server/services/document.service"
import { UploadLinkSchema } from "@/lib/server/validators/api.schemas"
import { logError, logInfo } from "@/lib/observability/logger"
import { invalidatePrefix } from "@/lib/cache"
import { KnowledgePipelineService } from "@/lib/server/services/knowledge-pipeline.service"

export const dynamic = "force-dynamic"
export const maxDuration = 60 // fetch + embeddings run inline (graph/schedule via /process)

export async function POST(request: Request) {
  try {
    const { userId, role } = await requireAuth()
    await requireRateLimit(userId, role)

    const body = await request.json().catch(() => null)
    const parsed = UploadLinkSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Datos inválidos." },
        { status: 400 },
      )
    }

    const upload = await DocumentService.processLink(userId, role, parsed.data.url)
    const generation = await KnowledgePipelineService.enqueueDocument(userId, upload.id).catch(
      (error) => {
        logError("api.upload.link.workflow_start_error", {
          uploadId: upload.id,
          error: error instanceof Error ? error.message : String(error),
        })
        return null
      },
    )

    await invalidatePrefix(`uploads:list:${userId}`)

    logInfo("api.upload.link.success", { userId, uploadId: upload.id })

    return NextResponse.json(
      {
        syllabus_id: upload.id,
        status: "pending",
        generation,
        message: "Link added; processing started.",
      },
      { status: 201 },
    )
  } catch (err) {
    if (err instanceof ApiErrorResponse) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    logError("api.upload.link.error", { error: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: "No se pudo procesar el enlace." }, { status: 500 })
  }
}
