import { NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { auth } from "@/lib/auth/config"
import { logInfo, logError } from "@/lib/observability/logger"

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id } = params
    const userId = session.user.id

    // Verify ownership
    const existing = await sql`
      SELECT id FROM syllabus_uploads 
      WHERE id = ${id}::uuid AND user_id = ${userId}
    `
    if ((existing as unknown[]).length === 0) {
      return NextResponse.json({ error: "Upload not found" }, { status: 404 })
    }

    // Delete the upload.
    // Thanks to ON DELETE CASCADE on topics and topic_dependencies,
    // and ON DELETE SET NULL on chats.syllabus_id, this is safe to just delete.
    await sql`
      DELETE FROM syllabus_uploads 
      WHERE id = ${id}::uuid AND user_id = ${userId}
    `

    logInfo("api.upload.deleted", { userId, uploadId: id })

    return NextResponse.json({ success: true })
  } catch (err) {
    logError("api.upload.delete_error", {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json(
      { error: "Failed to delete upload" },
      { status: 500 }
    )
  }
}
