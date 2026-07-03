/**
 * tools/tools/generate-study-set.tool.ts — Flashcards / quiz / summary on demand.
 *
 * Thin adapter over StudyService's STABLE public contract (getStudySet /
 * getCourseStudySet → StudySet). The Study Engine rework (rag-report §8,
 * Steps 2-5) rebuilds the INTERNALS behind this method; this tool only depends
 * on the public signature, so it stays insulated from that work.
 */

import type { Tool, ToolContext, ToolResult } from "../types"
import { StudyService } from "@/lib/server/services/study.service"
import type { StudySet, Difficulty } from "@/lib/server/rag/study-gen"

interface GenerateStudySetArgs {
  /** "syllabus" (default) reads the active/argument syllabus; "course" reads a course. */
  scope?: "syllabus" | "course"
  /** Target id; falls back to ctx.syllabusId when scope is "syllabus". */
  scopeId?: string
  difficulty?: Difficulty
  topic?: string
  /** Add fresh material instead of reusing the cached set. */
  refresh?: boolean
}

export const generateStudySetTool: Tool<GenerateStudySetArgs, StudySet> = {
  name: "generate_study_set",
  description:
    "Generate or fetch study material (flashcards, quiz, summary, mind map) for a syllabus or course the user owns. Use refresh=true to add new material beyond what's cached.",
  parameters: {
    type: "object",
    properties: {
      scope: {
        type: "string",
        enum: ["syllabus", "course"],
        description: "What to study (default 'syllabus').",
      },
      scopeId: {
        type: "string",
        description:
          "Syllabus or course id. Optional for 'syllabus' scope when an active syllabus is set.",
      },
      difficulty: {
        type: "string",
        enum: ["facil", "medio", "dificil"],
        description: "Target difficulty.",
      },
      topic: { type: "string", description: "Narrow generation to one topic." },
      refresh: {
        type: "boolean",
        description: "Add new material instead of reusing the cached set.",
      },
    },
    additionalProperties: false,
  },
  async execute(args: GenerateStudySetArgs, ctx: ToolContext): Promise<ToolResult<StudySet>> {
    const opts = { refresh: args.refresh, difficulty: args.difficulty, topic: args.topic }

    if (args.scope === "course") {
      if (!args.scopeId) return { ok: false, error: "scopeId required for course scope" }
      const set = await StudyService.getCourseStudySet(ctx.userId, args.scopeId, opts)
      return { ok: true, data: set }
    }

    const syllabusId = args.scopeId ?? ctx.syllabusId
    if (!syllabusId) return { ok: false, error: "no syllabus in scope" }
    const set = await StudyService.getStudySet(ctx.userId, syllabusId, opts)
    return { ok: true, data: set }
  },
}
