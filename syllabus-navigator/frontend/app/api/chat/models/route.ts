/**
 * GET /api/chat/models — List available models for the current user.
 */

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { getAvailableModels, DEFAULT_MODEL } from "@/lib/llm"
import { cached } from "@/lib/cache"
import type { Role } from "@/lib/auth/rbac"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userRole = (session.user.role ?? "free") as Role

  const models = await cached("models:list", 300, async () =>
    getAvailableModels(userRole),
  )

  return NextResponse.json({
    models,
    default: DEFAULT_MODEL,
  })
}
