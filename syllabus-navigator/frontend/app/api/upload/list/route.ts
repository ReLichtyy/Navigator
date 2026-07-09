/**
 * GET /api/upload/list — List uploaded syllabi for the current user.
 */

import { NextResponse } from "next/server"
import { requireAuth, ApiErrorResponse } from "@/lib/server/utils/auth-helpers"
import { DocumentRepository } from "@/lib/server/repositories/document.repo"
import { cached } from "@/lib/cache"
import { logError } from "@/lib/observability/logger"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const { userId } = await requireAuth()

    const rows = await cached(`uploads:list:${userId}`, 10, async () => {
      return DocumentRepository.listUploads(userId)
    })

    // Documents live in the PRIVATE blob store; never expose the raw blob URL.
    // Swap it for the authed proxy route the client can actually fetch.
    const uploads = rows.map((u) => ({
      ...u,
      file_url: u.file_url ? `/api/upload/${u.id}/file` : null,
    }))

    return NextResponse.json({ uploads })
  } catch (err) {
    if (err instanceof ApiErrorResponse) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    logError("api.upload.list_error", {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: "Failed to load uploads." }, { status: 500 })
  }
}
