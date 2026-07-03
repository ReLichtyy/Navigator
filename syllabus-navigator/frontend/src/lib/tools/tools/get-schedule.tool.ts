/**
 * tools/tools/get-schedule.tool.ts — Read the cronograma / upcoming events.
 *
 * Thin adapter over ScheduleService. With an active syllabus returns that
 * course's full schedule; otherwise returns the cross-course agenda
 * (today + upcoming events).
 */

import type { Tool, ToolContext, ToolResult } from "../types"
import { ScheduleService } from "@/lib/server/services/schedule.service"

// Empty args object — scope comes from ctx, not from the model.
type GetScheduleArgs = Record<string, never>

interface GetScheduleData {
  today?: string
  events: unknown[]
}

export const getScheduleTool: Tool<GetScheduleArgs, GetScheduleData> = {
  name: "get_schedule",
  description:
    "Read the user's cronograma (assessments, classes, deadlines). Returns the active course's schedule when a syllabus is set, otherwise the cross-course agenda (today + upcoming events).",
  parameters: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  async execute(_args: GetScheduleArgs, ctx: ToolContext): Promise<ToolResult<GetScheduleData>> {
    if (ctx.syllabusId) {
      const { events } = await ScheduleService.getForSyllabus(ctx.userId, ctx.syllabusId)
      return { ok: true, data: { events } }
    }
    const { today, events } = await ScheduleService.getAgenda(ctx.userId)
    return { ok: true, data: { today, events } }
  },
}
