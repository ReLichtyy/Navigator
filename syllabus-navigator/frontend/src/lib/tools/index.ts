/**
 * tools/index.ts — Actions & Tools layer entry point.
 *
 * Registers all tools, exposes them in OpenAI tool-calling format, and
 * provides a single `executeTool` dispatcher used by orchestration. Every tool
 * is wired to its real service; chat.service runs the loop when TOOLS_ENABLED.
 */

import { getTool, listTools, registerTool } from "./registry"
import type { OpenAIToolDef, ToolContext, ToolResult } from "./types"
import { retrieveContextTool } from "./tools/retrieve-context.tool"
import { getScheduleTool } from "./tools/get-schedule.tool"
import { getRecommendationsTool } from "./tools/get-recommendations.tool"
import { generateStudySetTool } from "./tools/generate-study-set.tool"
import { recordReviewTool } from "./tools/record-review.tool"

// --- Register built-in tools ------------------------------------------------
registerTool(retrieveContextTool)
registerTool(getScheduleTool)
registerTool(getRecommendationsTool)
registerTool(generateStudySetTool)
registerTool(recordReviewTool)

/** All tools serialized for an OpenAI/OpenRouter `tools: [...]` request. */
export function getToolDefinitions(): OpenAIToolDef[] {
  return listTools().map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }))
}

/**
 * Dispatch a tool call by name. Never throws — unknown tools and thrown
 * errors are normalized into a failed ToolResult.
 */
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const tool = getTool(name)
  if (!tool) {
    return { ok: false, error: `unknown tool "${name}"` }
  }
  try {
    return await tool.execute(args, ctx)
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "tool execution failed",
    }
  }
}

export { getTool, listTools, registerTool } from "./registry"
export type {
  OpenAIToolDef,
  Tool,
  ToolContext,
  ToolParameterSchema,
  ToolResult,
} from "./types"
