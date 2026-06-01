import { NextResponse } from "next/server"
import { requireAuth, ApiErrorResponse } from "@/lib/server/utils/auth-helpers"
import { DocumentRepository } from "@/lib/server/repositories/document.repo"
import { logInfo, logError } from "@/lib/observability/logger"

type RouteParams = { params: Promise<{ id: string }> }

export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    const { userId } = await requireAuth()
    const { id } = await params

    // Verify ownership
    const existing = await DocumentRepository.findByIdAndUser(id, userId)
    if (!existing) {
      return NextResponse.json({ error: "Upload not found" }, { status: 404 })
    }

    // Delete the upload.
    await DocumentRepository.deleteDocument(id)

    logInfo("api.upload.deleted", { userId, uploadId: id })

    return NextResponse.json({ success: true })
  } catch (err) {
    if (err instanceof ApiErrorResponse) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    
    logError("api.upload.delete_error", {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json(
      { error: "Failed to delete upload" },
      { status: 500 }
    )
  }
}
