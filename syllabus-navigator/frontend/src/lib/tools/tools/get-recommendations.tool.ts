/**
 * tools/tools/get-recommendations.tool.ts — Weekly study plan.
 *
 * Thin adapter over RecommendationService: assessments due, this-week topics,
 * and review hints across the user's courses.
 */

import type { Tool, ToolContext, ToolResult } from "../types"
import {
  RecommendationService,
  type WeeklyPlan,
} from "@/lib/server/services/recommendation.service"

type GetRecommendationsArgs = Record<string, never>

export const getRecommendationsTool: Tool<GetRecommendationsArgs, WeeklyPlan> = {
  name: "get_recommendations",
  description:
    "Get the user's weekly study plan: upcoming assessments, topics to focus on this week, and review hints across all their courses.",
  parameters: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  async execute(
    _args: GetRecommendationsArgs,
    ctx: ToolContext,
  ): Promise<ToolResult<WeeklyPlan>> {
    const plan = await RecommendationService.getWeeklyPlan(ctx.userId)
    return { ok: true, data: plan }
  },
}
