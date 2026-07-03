/**
 * tools/tools/record-review.tool.ts — Record a flashcard review (SRS).
 *
 * Thin adapter over StudyService.recordReview. Feeds the spaced-repetition box
 * + due date that the Planner (rag-report §8, Step 5) will later read back.
 */

import type { Tool, ToolContext, ToolResult } from "../types"
import { StudyService } from "@/lib/server/services/study.service"

interface RecordReviewArgs {
  cardKey: string
  known: boolean
  /** Falls back to ctx.syllabusId. */
  syllabusId?: string
}

export const recordReviewTool: Tool<RecordReviewArgs, { recorded: true }> = {
  name: "record_review",
  description:
    "Record the result of a flashcard review (known/again) to update the user's spaced-repetition schedule.",
  parameters: {
    type: "object",
    properties: {
      cardKey: { type: "string", description: "Stable identifier of the reviewed card." },
      known: { type: "boolean", description: "true if the user recalled it, false otherwise." },
      syllabusId: {
        type: "string",
        description: "Syllabus the card belongs to (optional if an active syllabus is set).",
      },
    },
    required: ["cardKey", "known"],
    additionalProperties: false,
  },
  async execute(args: RecordReviewArgs, ctx: ToolContext): Promise<ToolResult<{ recorded: true }>> {
    const syllabusId = args.syllabusId ?? ctx.syllabusId
    if (!syllabusId) return { ok: false, error: "no syllabus in scope" }
    await StudyService.recordReview(ctx.userId, syllabusId, args.cardKey, args.known)
    return { ok: true, data: { recorded: true } }
  },
}
