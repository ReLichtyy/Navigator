import { NextResponse } from "next/server"
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client"
import { requireAuth, requireRateLimit, ApiErrorResponse } from "@/lib/server/utils/auth-helpers"
import { logError } from "@/lib/observability/logger"

export const dynamic = "force-dynamic"

// Must match the accepted types + cap in document.service.ts.
const ACCEPTED_CONTENT_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]
const MAX_SIZE = 25 * 1024 * 1024 // 25MB

/**
 * Token endpoint for Vercel Blob client uploads. The browser hits this to get a
 * short-lived upload token, then uploads the file DIRECTLY to Blob — bypassing
 * the ~4.5MB serverless request-body limit. After the upload finishes the client
 * calls /api/upload/from-blob with the returned URL to ingest it.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => {
        // Only authenticated, non-guest users may store files in blob.
        const { userId, role } = await requireAuth()
        if (role === "guest") {
          throw new Error("Guests cannot use direct uploads.")
        }
        await requireRateLimit(userId, role)
        return {
          allowedContentTypes: ACCEPTED_CONTENT_TYPES,
          maximumSizeInBytes: MAX_SIZE,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ userId }),
        }
      },
      // Ingestion is triggered explicitly by the client (/api/upload/from-blob),
      // not here — this webhook can't reach localhost in dev anyway.
      onUploadCompleted: async () => {},
    })

    return NextResponse.json(jsonResponse)
  } catch (err) {
    logError("api.upload.blob_token.error", {
      error: err instanceof Error ? err.message : String(err),
    })
    if (err instanceof ApiErrorResponse) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    // Never echo raw internal errors (SDK/env details) back to the client.
    return NextResponse.json({ error: "No se pudo autorizar la subida." }, { status: 400 })
  }
}
