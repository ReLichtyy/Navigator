/**
 * tools/tools/retrieve-context.tool.ts — Retrieve relevant syllabus chunks.
 *
 * Thin adapter over RetrievalService: scopes to one syllabus when ctx carries
 * one, otherwise searches across all the user's courses. Returns the grounded
 * context block + citations the chat path already uses.
 */

import type { Tool, ToolContext, ToolResult } from "../types"
import { RetrievalService } from "@/lib/server/services/retrieval.service"
import type { CitationAPI } from "@/types/api"

interface RetrieveArgs {
  query: string
}

interface RetrieveData {
  hasContext: boolean
  contextBlock: string
  citations: CitationAPI[]
}

export const retrieveContextTool: Tool<RetrieveArgs, RetrieveData> = {
  name: "retrieve_context",
  description:
    "Search the user's syllabi for passages relevant to a query. Returns a grounded context block with citations. Scopes to the active syllabus when one is set, otherwise searches all the user's courses.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Natural-language search query." },
    },
    required: ["query"],
    additionalProperties: false,
  },
  async execute(
    args: RetrieveArgs,
    ctx: ToolContext,
  ): Promise<ToolResult<RetrieveData>> {
    const result = ctx.syllabusId
      ? await RetrievalService.retrieve(ctx.syllabusId, args.query)
      : await RetrievalService.retrieveForUser(ctx.userId, args.query)
    return { ok: true, data: result }
  },
}
