/**
 * GET /api/chat/models — List available models for the current user.
 */

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { getAvailableModels, DEFAULT_MODEL } from "@/lib/llm"
import { getModelDef } from "@/lib/llm/config"
import { cached } from "@/lib/cache"
import type { Role } from "@/lib/auth/rbac"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userRole = (session.user.role ?? "free") as Role

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
