/**
 * DELETE /api/user — Delete the caller's account data in Neon (+ blobs).
 *
 * Part of "Zona de peligro" in Configuración → Cuenta. The client calls this
 * FIRST and only then deletes the Clerk user (`user.delete()`), so a failure
 * here leaves both sides intact. Best-effort blob cleanup afterwards.
 */

import { NextResponse } from "next/server"
import { requireAuth, ApiErrorResponse } from "@/lib/server/utils/auth-helpers"
import { deleteUser } from "@/lib/server/repositories/user.repo"
import { delBlob, isBlobUrl } from "@/lib/server/storage/blob"
import { invalidatePrefix } from "@/lib/cache"
import { logError, logInfo } from "@/lib/observability/logger"

export const dynamic = "force-dynamic"

export async function DELETE() {
  try {
    const { userId } = await requireAuth()

    const { fileUrls } = await deleteUser(userId)

    // Best-effort cleanup: stored blobs + any cached reads for this user.
    await Promise.all(fileUrls.filter(isBlobUrl).map((url) => delBlob(url)))
    await invalidatePrefix(`user:prefs:${userId}`).catch(() => {})

    logInfo("api.user.deleted", { userId, blobs: fileUrls.length })
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof ApiErrorResponse) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    logError("api.user.delete_error", {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: "No se pudo eliminar la cuenta." }, { status: 500 })
  }
}
