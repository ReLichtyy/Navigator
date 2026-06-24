import { NextResponse } from "next/server"
import { requireAuth, requireRateLimit, ApiErrorResponse } from "@/lib/server/utils/auth-helpers"
import { DocumentService } from "@/lib/server/services/document.service"
import { triggerIngestionWorker } from "@/lib/server/services/worker-trigger"
import { UploadTextSchema } from "@/lib/server/validators/api.schemas"
import { logError, logInfo } from "@/lib/observability/logger"
import { invalidatePrefix } from "@/lib/cache"

export const dynamic = "force-dynamic"
export const maxDuration = 60 // embeddings + graph run inline

export async function POST(request: Request) {
  try {
    const { userId, role } = await requireAuth()
    await requireRateLimit(userId, role)

    const body = await request.json().catch(() => null)
    const parsed = UploadTextSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Datos inválidos." },
        { status: 400 },
      )
    }

    const upload = await DocumentService.processText(
      userId,
      role,
      parsed.data.title ?? "",
      parsed.data.text,
    )

    await triggerIngestionWorker()
    await invalidatePrefix(`uploads:list:${userId}`)

    logInfo("api.upload.text.success", { userId, uploadId: upload.id })

    return NextResponse.json(
      { syllabus_id: upload.id, status: "processed", message: "Text added and processed." },
      { status: 201 },
    )
  } catch (err) {
    if (err instanceof ApiErrorResponse) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    logError("api.upload.text.error", { error: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: "No se pudo procesar el texto." }, { status: 500 })
  }
}
