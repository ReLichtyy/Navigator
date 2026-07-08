/**
 * POST   /api/user/avatar — Upload a profile avatar (multipart, ≤2MB, png/jpeg/webp).
 * DELETE /api/user/avatar — Remove the avatar (clears users.image, deletes the blob).
 *
 * The image lands in Vercel Blob (avatars/<userId>/…) and its URL in
 * `users.image`. The client downsizes before uploading; here we only enforce
 * type + size. Requires blob storage to be configured (503 otherwise).
 */

import { NextResponse } from "next/server"
import { requireAuth, requireRateLimit, ApiErrorResponse } from "@/lib/server/utils/auth-helpers"
import {
  storeAvatar,
  delBlob,
  isBlobUrl,
  isBlobConfigured,
  isAvatarContentType,
} from "@/lib/server/storage/blob"
import { getUserImage, setUserImage } from "@/lib/server/repositories/user.repo"
import { logError, logInfo } from "@/lib/observability/logger"

export const dynamic = "force-dynamic"

const MAX_AVATAR_BYTES = 2 * 1024 * 1024 // 2MB

export async function POST(request: Request) {
  try {
    const { userId, role } = await requireAuth()
    await requireRateLimit(userId, role)

    if (!isBlobConfigured()) {
      return NextResponse.json(
        { error: "El almacenamiento de imágenes no está configurado." },
        { status: 503 },
      )
    }

    const formData = await request.formData().catch(() => null)
    const file = formData?.get("file") as File | null
    if (!file) {
      return NextResponse.json({ error: "No se recibió ninguna imagen." }, { status: 400 })
    }
    if (!isAvatarContentType(file.type)) {
      return NextResponse.json(
        { error: "Formato no soportado. Usa PNG, JPG o WebP." },
        { status: 400 },
      )
    }
    if (file.size > MAX_AVATAR_BYTES) {
      return NextResponse.json({ error: "La imagen supera el límite de 2MB." }, { status: 400 })
    }

    const bytes = new Uint8Array(await file.arrayBuffer())
    const url = await storeAvatar(userId, bytes, file.type)
    if (!url) {
      return NextResponse.json({ error: "No se pudo guardar la imagen." }, { status: 500 })
    }

    // Swap the row first, then clean up the previous blob (best-effort).
    const previous = await getUserImage(userId)
    await setUserImage(userId, url)
    if (previous && isBlobUrl(previous)) await delBlob(previous)

    logInfo("api.user.avatar.uploaded", { userId })
    return NextResponse.json({ url })
  } catch (err) {
    if (err instanceof ApiErrorResponse) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    logError("api.user.avatar.post_error", {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: "No se pudo subir la imagen." }, { status: 500 })
  }
}

export async function DELETE() {
  try {
    const { userId } = await requireAuth()

    const previous = await getUserImage(userId)
    await setUserImage(userId, null)
    if (previous && isBlobUrl(previous)) await delBlob(previous)

    logInfo("api.user.avatar.removed", { userId })
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof ApiErrorResponse) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    logError("api.user.avatar.delete_error", {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: "No se pudo quitar la imagen." }, { status: 500 })
  }
}
