/**
 * GET /api/upload/list — List uploaded syllabi for the current user.
 */

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/config"
import { sql } from "@/lib/db"
import { cached } from "@/lib/cache"
import { logError } from "@/lib/observability/logger"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const userId = session.user.id

    const uploads = await cached(`uploads:list:${userId}`, 60, async () => {
      const rows = await sql`
        SELECT id, original_filename, status, graph_status, created_at
        FROM syllabus_uploads
        WHERE user_id = ${userId}
        ORDER BY created_at DESC
      `
      return rows
    })

    return NextResponse.json({ uploads })
  } catch (err) {
    logError("api.upload.list_error", {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: "Failed to load uploads." }, { status: 500 })
  }
}
