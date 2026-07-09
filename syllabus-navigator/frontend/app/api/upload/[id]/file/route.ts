/**
 * GET /api/upload/[id]/file — stream a document's stored file to its owner.
 *
 * Source documents live in the PRIVATE Vercel Blob store, so their blob URL is
 * not publicly fetchable. This route is the only read path: it authenticates the
 * caller, checks they own the document, then streams the blob back (proxied with
 * the store token). The client uses this URL in the PDF preview iframe and in
 * chat citation links instead of a raw blob URL.
 */

import { NextResponse } from "next/server"
import { requireAuth, ApiErrorResponse } from "@/lib/server/utils/auth-helpers"
import { DocumentRepository } from "@/lib/server/repositories/document.repo"
import { fetchPrivateBlob } from "@/lib/server/storage/blob"
import { logError } from "@/lib/observability/logger"

export const dynamic = "force-dynamic"

type RouteParams = { params: Promise<{ id: string }> }

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { userId } = await requireAuth()
    const { id } = await params

    // Ownership-scoped: same 404 for "not found" and "not yours" (don't leak existence).
    const doc = await DocumentRepository.findByIdAndUser(id, userId)
    if (!doc || !doc.file_url) {
      return NextResponse.json({ error: "No encontrado." }, { status: 404 })
    }

    const res = await fetchPrivateBlob(doc.file_url)
    if (!res || !res.ok || !res.body) {
      return NextResponse.json({ error: "No se pudo leer el archivo." }, { status: 502 })
    }

    const contentType = res.headers.get("content-type") ?? "application/octet-stream"
    return new NextResponse(res.body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        // Inline so the browser/PDF viewer renders it in the iframe.
        "Content-Disposition": "inline",
        // Per-user private data — never cache in shared proxies.
        "Cache-Control": "private, no-store",
      },
    })
  } catch (err) {
    if (err instanceof ApiErrorResponse) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    logError("api.upload.file_error", {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: "No se pudo servir el archivo." }, { status: 500 })
  }
}
