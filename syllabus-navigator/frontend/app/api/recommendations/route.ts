/**
 * GET /api/recommendations — the caller's dynamic weekly study plan
 * (upcoming assessments + this week's topics + "review first" prerequisites).
 */

import { NextResponse } from "next/server"
import { requireAuth, ApiErrorResponse } from "@/lib/server/utils/auth-helpers"
import { RecommendationService } from "@/lib/server/services/recommendation.service"
import { logError } from "@/lib/observability/logger"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const { userId } = await requireAuth()
    const plan = await RecommendationService.getWeeklyPlan(userId)
    return NextResponse.json(plan)
  } catch (err) {
    if (err instanceof ApiErrorResponse) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    logError("api.recommendations.get_error", {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: "Failed to load recommendations." }, { status: 500 })
  }
}
