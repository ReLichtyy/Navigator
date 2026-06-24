/**
 * GET /api/usage — Get usage summary for the authenticated user.
 */

import { NextResponse } from "next/server"
import { getAuthedUser } from "@/lib/server/utils/auth-helpers"
import { getUserUsage } from "@/lib/metering"
import { cached } from "@/lib/cache"
import { logError } from "@/lib/observability/logger"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  try {
    const session = await getAuthedUser()
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const url = new URL(request.url)
    const days = parseInt(url.searchParams.get("days") ?? "30", 10)

    const usage = await cached(`usage:${session.userId}:${days}`, 30, () =>
      getUserUsage(session.userId, days),
    )

    return NextResponse.json({ usage })
  } catch (err) {
    logError("api.usage.error", {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: "Failed to load usage data." }, { status: 500 })
  }
}
