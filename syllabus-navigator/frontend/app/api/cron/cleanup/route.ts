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
    // 1. Verify Vercel Cron Secret (Standard pattern).
    // Fail CLOSED: if CRON_SECRET isn't configured, this destructive endpoint must NOT run,
    // otherwise /api/cron (public in middleware) would let anyone wipe guest data.
    const authHeader = request.headers.get("authorization")
    const cronSecret = process.env.CRON_SECRET

    if (!cronSecret) {
      logError("cron.cleanup.misconfigured", { reason: "CRON_SECRET not set" })
      return NextResponse.json({ error: "Cron not configured" }, { status: 500 })
    }

    if (authHeader !== `Bearer ${cronSecret}`) {
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

    // 3. Delete expired ephemeral uploads (guest sessions). chunks, topics and
    // topic_dependencies are removed via ON DELETE CASCADE. Note syllabus_uploads.user_id
    // is TEXT (not an FK to users), so this expires_at sweep is what reclaims guest uploads.
    const expiredUploads = await sql`
      DELETE FROM syllabus_uploads
      WHERE expires_at IS NOT NULL AND expires_at < NOW()
      RETURNING id
    `
    const expiredUploadsCount = (expiredUploads as { id: string }[]).length

    logInfo("cron.cleanup.success", {
      deleted_users: deletedCount,
      expired_uploads: expiredUploadsCount,
    })

    return NextResponse.json(
      {
        message: "Cleanup completed successfully",
        deleted_count: deletedCount,
        expired_uploads: expiredUploadsCount,
      },
      { status: 200 },
    )
  } catch (error) {
    logError("cron.cleanup.error", { error: String(error) })
    return NextResponse.json({ error: "Failed to run cleanup" }, { status: 500 })
  }
}
