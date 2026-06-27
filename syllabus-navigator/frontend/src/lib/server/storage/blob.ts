/**
 * server/storage/blob.ts — PDF persistence in Vercel Blob (accounts only).
 *
 * Degrades gracefully: if BLOB_READ_WRITE_TOKEN isn't configured, returns null
 * so the app still works (the PDF just isn't kept; chunks/embeddings still are).
 */

import { put, del } from "@vercel/blob"
import { logWarn, logError } from "@/lib/observability/logger"

export function isBlobConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN)
}

/** Store a source file and return its public URL, or null if storage is unavailable. */
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
      access: "public",
      contentType,
    })
    return blob.url
  } catch (err) {
    logError("storage.blob.error", { error: err instanceof Error ? err.message : String(err) })
    return null
  }
}

/** Delete a blob by URL. Best-effort: used to clean up orphans on failed ingest. */
export async function delBlob(url: string): Promise<void> {
  if (!isBlobConfigured()) return
  try {
    await del(url)
  } catch (err) {
    logWarn("storage.blob.del_failed", { error: err instanceof Error ? err.message : String(err) })
  }
}
