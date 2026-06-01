import { NextResponse } from "next/server"
import { requireAuth, requireRateLimit, ApiErrorResponse } from "@/lib/server/utils/auth-helpers"
import { DocumentService } from "@/lib/server/services/document.service"
import { logError, logInfo } from "@/lib/observability/logger"
import { invalidatePrefix } from "@/lib/cache"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  try {
    const { userId, role } = await requireAuth()

    if (role === "guest") {
      return NextResponse.json({ error: "Guests cannot upload files. Please create an account to unlock this feature." }, { status: 403 })
    }

    await requireRateLimit(userId, role)

    const formData = await request.formData().catch(() => null)
    if (!formData) {
      return NextResponse.json({ error: "No form data provided." }, { status: 400 })
    }

    const file = formData.get("file") as File | null
    if (!file) {
      return NextResponse.json({ error: "No file provided." }, { status: 400 })
    }

    const upload = await DocumentService.processUpload(userId, file)

    await invalidatePrefix(`uploads:list:${userId}`)

    logInfo("api.upload.success", { userId, uploadId: upload.id, filename: upload.original_filename })

    return NextResponse.json(
      {
        syllabus_id: upload.id,
        message: "File uploaded successfully.",
      },
      { status: 201 }
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
