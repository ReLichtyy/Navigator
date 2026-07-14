import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock the services the tools adapt so importing the tools layer never touches
// the DB / LLM. Each mock returns a recognizable shape we assert on below.
vi.mock("@/lib/server/services/retrieval.service", () => ({
  RetrievalService: {
    retrieve: vi.fn(async () => ({ hasContext: true, contextBlock: "ctx", citations: [] })),
    retrieveForUser: vi.fn(async () => ({ hasContext: false, contextBlock: "", citations: [] })),
  },
  GROUNDED_SYSTEM_PROMPT: "",
  NO_CONTEXT_MESSAGE: "",
}))
vi.mock("@/lib/server/services/schedule.service", () => ({
  ScheduleService: {
    getAgenda: vi.fn(async () => ({ today: "2026-06-25", events: [] })),
    getForSyllabus: vi.fn(async () => ({ events: [{ id: "e1" }] })),
  },
}))
vi.mock("@/lib/server/services/recommendation.service", () => ({
  RecommendationService: { getWeeklyPlan: vi.fn(async () => ({ week: "x" })) },
}))
vi.mock("@/lib/server/services/study.service", () => ({
  StudyService: {
    getStudySet: vi.fn(async () => ({ flashcards: [], quiz: [] })),
    getCourseStudySet: vi.fn(async () => ({ flashcards: [], quiz: [] })),
    recordReview: vi.fn(async () => undefined),
  },
}))

import { getToolDefinitions, executeTool, listTools } from "@/lib/tools"
import { StudyService } from "@/lib/server/services/study.service"

describe("tools registry", () => {
  it("registers the five built-in tools", () => {
    const names = listTools().map((t) => t.name).sort()
    expect(names).toEqual(
      ["generate_study_set", "get_recommendations", "get_schedule", "record_review", "retrieve_context"].sort(),
    )
  })

  it("exposes OpenAI-format definitions with object-schema params", () => {
    const defs = getToolDefinitions()
    expect(defs).toHaveLength(5)
    for (const d of defs) {
      expect(d.type).toBe("function")
      expect(d.function.parameters.type).toBe("object")
      expect(typeof d.function.name).toBe("string")
      expect(typeof d.function.description).toBe("string")
    }
  })
})

describe("executeTool dispatch", () => {
  const ctx = { userId: "u1", syllabusId: "s1", chatId: "c1" }

  beforeEach(() => vi.clearAllMocks())

  it("returns a failed result for an unknown tool (never throws)", async () => {
    const r = await executeTool("does_not_exist", {}, ctx)
    expect(r.ok).toBe(false)
    expect(r.error).toContain("unknown tool")
  })

  it("retrieve_context uses the syllabus scope when one is set", async () => {
    const r = await executeTool("retrieve_context", { query: "q" }, ctx)
    expect(r.ok).toBe(true)
    expect(r.data).toMatchObject({ hasContext: true })
  })

  it("get_schedule returns the course schedule when scoped", async () => {
    const r = await executeTool("get_schedule", {}, ctx)
    expect(r.ok).toBe(true)
    expect(r.data).toMatchObject({ events: [{ id: "e1" }] })
  })

  it("record_review fails cleanly with no syllabus in scope", async () => {
    const r = await executeTool("record_review", { cardKey: "k", known: true }, {
      userId: "u1",
      chatId: "c1",
    })
    expect(r.ok).toBe(false)
    expect(StudyService.recordReview).not.toHaveBeenCalled()
  })

  it("record_review calls the service when a syllabus is in scope", async () => {
    const r = await executeTool("record_review", { cardKey: "k", known: false }, ctx)
    expect(r.ok).toBe(true)
    // The chat is always on one syllabus → doc scope.
    expect(StudyService.recordReview).toHaveBeenCalledWith(
      "u1",
      { kind: "doc", id: "s1" },
      "k",
      false,
    )
  })

  it("generate_study_set requires scopeId for course scope", async () => {
    const r = await executeTool("generate_study_set", { scope: "course" }, ctx)
    expect(r.ok).toBe(false)
    expect(StudyService.getCourseStudySet).not.toHaveBeenCalled()
  })
})
