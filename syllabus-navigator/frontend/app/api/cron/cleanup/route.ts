/**
 * GET /api/cron/cleanup
 * Vercel Cron Job to delete old guest users and their orphan data.
 * Protected by CRON_SECRET env variable.
 */

import { NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { logError, logInfo } from "@/lib/observability/logger"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  try {
    // 1. Verify Vercel Cron Secret (Standard pattern)
    const authHeader = request.headers.get("authorization")
    const cronSecret = process.env.CRON_SECRET

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      logError("cron.cleanup.unauthorized", { ip: request.headers.get("x-forwarded-for") })
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // 2. Delete Guest Users older than 24 hours
    // Because of ON DELETE CASCADE, this will also delete their chats, messages, and usage_records
    const result = await sql`
      DELETE FROM users 
      WHERE role = 'guest' 
        AND created_at < NOW() - INTERVAL '24 HOURS'
      RETURNING id
    `
    const deletedCount = (result as { id: string }[]).length

    logInfo("cron.cleanup.success", { deleted_count: deletedCount })

    return NextResponse.json(
      { message: "Cleanup completed successfully", deleted_count: deletedCount },
      { status: 200 }
    )
  } catch (error) {
    logError("cron.cleanup.error", { error: String(error) })
    return NextResponse.json({ error: "Failed to run cleanup" }, { status: 500 })
  }
}
