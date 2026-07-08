import { NextResponse } from "next/server"
import { requireAuth, ApiErrorResponse } from "@/lib/server/utils/auth-helpers"
import { DocumentRepository } from "@/lib/server/repositories/document.repo"
import { delBlob } from "@/lib/server/storage/blob"
import { logInfo, logError } from "@/lib/observability/logger"
import { invalidatePrefix } from "@/lib/cache"
import { z } from "zod"

type RouteParams = { params: Promise<{ id: string }> }

const RenameSchema = z.object({
  name: z.string().min(1, "Name is required").max(255, "Name too long"),
})

export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { userId } = await requireAuth()
    const { id } = await params

    const body = await request.json().catch(() => null)
    const parsed = RenameSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const existing = await DocumentRepository.findByIdAndUser(id, userId)
    if (!existing) {
      return NextResponse.json({ error: "Upload not found" }, { status: 404 })
    }

    const updated = await DocumentRepository.renameDocument(id, userId, parsed.data.name)
    await invalidatePrefix(`uploads:list:${userId}`)

    logInfo("api.upload.renamed", { userId, uploadId: id, newName: parsed.data.name })

    return NextResponse.json({ upload: updated })
  } catch (err) {
    if (err instanceof ApiErrorResponse) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    logError("api.upload.rename_error", {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: "Failed to rename upload" }, { status: 500 })
  }
}

export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    const { userId } = await requireAuth()
    const { id } = await params

    // Verify ownership
    const existing = await DocumentRepository.findByIdAndUser(id, userId)
    if (!existing) {
      return NextResponse.json({ error: "Upload not found" }, { status: 404 })
    }

    // Delete the upload, then its stored file (best-effort: a failed blob
    // delete only leaves an orphan file, never a broken row).
    await DocumentRepository.deleteDocument(id, userId)
    if (existing.file_url) await delBlob(existing.file_url)
    await invalidatePrefix(`uploads:list:${userId}`)

    logInfo("api.upload.deleted", { userId, uploadId: id })

    return NextResponse.json({ success: true })
  } catch (err) {
    if (err instanceof ApiErrorResponse) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }

    logError("api.upload.delete_error", {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: "Failed to delete upload" }, { status: 500 })
  }
}
