/**
 * GET /api/chat/models — List available models for the current user.
 */

import { NextResponse } from "next/server"
import { getAuthedUser } from "@/lib/server/utils/auth-helpers"
import { getAvailableModels, DEFAULT_MODEL } from "@/lib/llm"
import { getModelDef } from "@/lib/llm/config"
import { cached } from "@/lib/cache"

export async function GET() {
  const session = await getAuthedUser()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userRole = session.role

  // Cache per-role so admins/pro get the full list and free users the trimmed one.
  const models = await cached(`models:list:${userRole}`, 300, async () =>
    getAvailableModels(userRole).map((id) => ({
      id,
      displayName: getModelDef(id)?.displayName ?? id,
    })),
  )

  return NextResponse.json({
    models,
    default: DEFAULT_MODEL,
  })
}
