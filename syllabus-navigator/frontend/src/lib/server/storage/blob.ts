/**
 * server/storage/blob.ts — binary file persistence in Vercel Blob (accounts only).
 *
 * Two stores, by sensitivity:
 *   • PRIVATE (BLOB_READ_WRITE_TOKEN)  → source documents (PDF/office). Not publicly
 *     fetchable; read server-side with the token and served via an authed proxy
 *     route (/api/upload/[id]/file) so only the owner can see them.
 *   • PUBLIC  (BLOB_PUBLIC_TOKEN)      → profile avatars. Meant to be shown via <img>.
 *
 * Degrades gracefully: if a token isn't configured, the store's writes return null
 * so the app still works (the file just isn't kept; chunks/embeddings still are).
 */

import { put, del } from "@vercel/blob"
import { logWarn, logError } from "@/lib/observability/logger"

const PRIVATE_TOKEN = () => process.env.BLOB_READ_WRITE_TOKEN
const PUBLIC_TOKEN = () => process.env.BLOB_PUBLIC_TOKEN

/** Private store (documents) configured? */
export function isBlobConfigured(): boolean {
  return Boolean(PRIVATE_TOKEN())
}

/** Public store (avatars) configured? */
export function isPublicBlobConfigured(): boolean {
  return Boolean(PUBLIC_TOKEN())
}

/**
 * Store a source file in the PRIVATE store and return its (private) blob URL, or
 * null if storage is unavailable. The URL is not publicly fetchable — read it
 * back with `fetchPrivateBlob` / serve it through the authed proxy route.
 */
export async function storePdf(
  userId: string,
  filename: string,
  bytes: Uint8Array,
  contentType = "application/pdf",
): Promise<string | null> {
  if (!isBlobConfigured()) {
    logWarn("storage.blob.skipped", { reason: "BLOB_READ_WRITE_TOKEN not set" })
    return null
  }
  try {
    const safeName = filename.replace(/[^\w.\-]+/g, "_")
    const key = `syllabi/${userId}/${Date.now()}-${safeName}`
    const blob = await put(key, Buffer.from(bytes), {
      access: "private",
      contentType,
      token: PRIVATE_TOKEN(),
    })
    return blob.url
  } catch (err) {
    logError("storage.blob.error", { error: err instanceof Error ? err.message : String(err) })
    return null
  }
}

/**
 * Fetch a private blob's bytes server-side. Private URLs 403 on a plain GET; the
 * read-write token authorizes access via the Authorization header. Returns the
 * raw Response (caller streams/reads it) or null on failure.
 */
export async function fetchPrivateBlob(url: string): Promise<Response | null> {
  const token = PRIVATE_TOKEN()
  if (!token) return null
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    return res.ok ? res : null
  } catch (err) {
    logError("storage.blob.fetch_failed", {
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

const AVATAR_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
}

/** Content types accepted for profile avatars (route validates size). */
export function isAvatarContentType(contentType: string): boolean {
  return contentType in AVATAR_EXT
}

/**
 * Store a profile avatar in the PUBLIC store and return its public URL, or null
 * if storage is unavailable. Size/type limits are enforced by the route; the
 * client downsizes the image before upload, so no server-side resize is needed.
 */
export async function storeAvatar(
  userId: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<string | null> {
  if (!isPublicBlobConfigured()) {
    logWarn("storage.blob.skipped", { reason: "BLOB_PUBLIC_TOKEN not set" })
    return null
  }
  try {
    const key = `avatars/${userId}/${Date.now()}.${AVATAR_EXT[contentType] ?? "jpg"}`
    const blob = await put(key, Buffer.from(bytes), {
      access: "public",
      contentType,
      token: PUBLIC_TOKEN(),
    })
    return blob.url
  } catch (err) {
    logError("storage.blob.error", { error: err instanceof Error ? err.message : String(err) })
    return null
  }
}

/** True when a URL points into our Vercel Blob store (private or public). */
export function isBlobUrl(url: string): boolean {
  return /\.blob\.vercel-storage\.com\//.test(url)
}

/**
 * Delete a blob by URL. Best-effort. Picks the store token by URL: private-store
 * hosts (documents) use the RW token, public-store hosts (avatars) the public one.
 */
export async function delBlob(url: string): Promise<void> {
  const isPublic = /\.public\.blob\.vercel-storage\.com\//.test(url)
  const token = isPublic ? PUBLIC_TOKEN() : PRIVATE_TOKEN()
  if (!token) return
  try {
    await del(url, { token })
  } catch (err) {
    logWarn("storage.blob.del_failed", { error: err instanceof Error ? err.message : String(err) })
  }
}
