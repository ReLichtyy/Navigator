/**
 * GET /api/usage — Get usage summary for the authenticated user.
 */

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { getUserUsage } from "@/lib/metering"
import { cached } from "@/lib/cache"
import { logError } from "@/lib/observability/logger"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const url = new URL(request.url)
    const days = parseInt(url.searchParams.get("days") ?? "30", 10)

    const usage = await cached(`usage:${session.user.id}:${days}`, 30, () =>
      getUserUsage(session.user.id, days),
    )

    return NextResponse.json({ usage })
  } catch (err) {
    logError("api.usage.error", {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: "Failed to load usage data." }, { status: 500 })
  }
}
