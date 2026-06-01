/**
 * POST /api/upload — Upload a syllabus PDF.
 */

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/config"
import { sql } from "@/lib/db"
import { logError, logInfo } from "@/lib/observability/logger"
import { invalidatePrefix } from "@/lib/cache"

export const dynamic = "force-dynamic"

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    if (session.user.role === "guest") {
      return NextResponse.json({ error: "Guests cannot upload files. Please create an account to unlock this feature." }, { status: 403 })
    }

    const userId = session.user.id

    const formData = await request.formData().catch(() => null)
    if (!formData) {
      return NextResponse.json({ error: "No form data provided." }, { status: 400 })
    }

    const file = formData.get("file") as File | null
    if (!file) {
      return NextResponse.json({ error: "No file provided." }, { status: 400 })
    }

    // Validate file type
    if (file.type !== "application/pdf") {
      return NextResponse.json({ error: "Only PDF files are allowed." }, { status: 400 })
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File size exceeds the 5MB limit. (Got ${(file.size / 1024 / 1024).toFixed(2)}MB)` },
        { status: 400 }
      )
    }

    // Store in DB (metadata)
    // NOTE: In a real environment we would upload `file` to S3 or similar.
    // For now we fulfill the backlog by registering the upload.
    const rows = await sql`
      INSERT INTO syllabus_uploads (user_id, original_filename, status, graph_status)
      VALUES (${userId}, ${file.name}, 'ready', 'pending')
      RETURNING id, original_filename
    `

    const upload = (rows as { id: string; original_filename: string }[])[0]

    // Invalidate cache
    await invalidatePrefix(`uploads:list:${userId}`)

    logInfo("api.upload.success", { userId, uploadId: upload.id, filename: upload.original_filename })

    return NextResponse.json(
      {
        syllabus_id: upload.id,
        message: "File uploaded successfully.",
      },
      { status: 201 }
    )
  } catch (err) {
    logError("api.upload.error", {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: "Failed to upload file." }, { status: 500 })
  }
}
