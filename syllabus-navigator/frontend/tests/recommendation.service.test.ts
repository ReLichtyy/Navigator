import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import type { ScheduleEvent } from "@/lib/server/repositories/schedule.repo"

const listAgendaByUser = vi.fn<() => Promise<ScheduleEvent[]>>()
const listUserTopicsWithPrereqs =
  vi.fn<() => Promise<{ syllabus_id: string; label: string; prereqs: string[] }[]>>()

vi.mock("@/lib/server/repositories/schedule.repo", () => ({
  ScheduleRepository: { listAgendaByUser: (...a: unknown[]) => listAgendaByUser(...(a as [])) },
}))
vi.mock("@/lib/server/repositories/graph.repo", () => ({
  GraphRepository: {
    listUserTopicsWithPrereqs: (...a: unknown[]) => listUserTopicsWithPrereqs(...(a as [])),
  },
}))

import { RecommendationService } from "@/lib/server/services/recommendation.service"

function ev(partial: Partial<ScheduleEvent>): ScheduleEvent {
  return {
    id: "e1",
    syllabus_id: "s1",
    course_id: null,
    course_name: "Álgebra",
    doc_name: "algebra.pdf",
    course_color: null,
    event_type: "class",
    title: "Clase",
    description: null,
    event_date: null,
    week_label: null,
    weight_percent: null,
    term_start: null,
    ...partial,
  }
}

beforeEach(() => {
  // Wednesday 2026-07-01 → week = Mon 2026-06-29 .. Sun 2026-07-05
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-07-01T12:00:00"))
  listAgendaByUser.mockResolvedValue([])
  listUserTopicsWithPrereqs.mockResolvedValue([])
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe("RecommendationService.getWeeklyPlan", () => {
  it("computes the Monday-anchored week range", async () => {
    const plan = await RecommendationService.getWeeklyPlan("u1")
    expect(plan.today).toBe("2026-07-01")
    expect(plan.week_start).toBe("2026-06-29")
    expect(plan.week_end).toBe("2026-07-05")
  })

  it("this_week_topics keeps only class/reading events inside the week", async () => {
    listAgendaByUser.mockResolvedValue([
      ev({ id: "in", event_type: "class", event_date: "2026-07-01" }),
      ev({ id: "edge-mon", event_type: "reading", event_date: "2026-06-29" }),
      ev({ id: "out", event_type: "class", event_date: "2026-07-08" }), // next week
      ev({ id: "quiz", event_type: "quiz", event_date: "2026-07-01" }), // not class/reading
      ev({ id: "undated", event_type: "class", event_date: null }), // "Semana N" only
    ])
    const plan = await RecommendationService.getWeeklyPlan("u1")
    expect(plan.this_week_topics.map((e) => e.id).sort()).toEqual(["edge-mon", "in"])
  })

  it("an upcoming assessment crossed with the graph yields 'review first' prereqs", async () => {
    listAgendaByUser.mockResolvedValue([
      ev({ id: "q1", event_type: "quiz", title: "Quiz de Matrices", event_date: "2026-07-04" }),
    ])
    listUserTopicsWithPrereqs.mockResolvedValue([
      { syllabus_id: "s1", label: "Matrices", prereqs: ["Vectores", "Determinantes"] },
      // same label in ANOTHER syllabus must not leak into s1's review list
      { syllabus_id: "s2", label: "Matrices", prereqs: ["Otro curso"] },
    ])
    const plan = await RecommendationService.getWeeklyPlan("u1")
    expect(plan.upcoming_assessments).toHaveLength(1)
    const a = plan.upcoming_assessments[0]
    expect(a.days_until).toBe(3)
    expect(a.review_first).toEqual(["Vectores", "Determinantes"])
  })

  it("drops assessments beyond the 21-day horizon, keeps undated ones (days_until null)", async () => {
    listAgendaByUser.mockResolvedValue([
      ev({ id: "far", event_type: "exam", event_date: "2026-07-31" }), // 30 days out
      ev({ id: "undated", event_type: "assignment", event_date: null, week_label: "Semana 12" }),
      ev({ id: "near", event_type: "quiz", event_date: "2026-07-10" }),
    ])
    const plan = await RecommendationService.getWeeklyPlan("u1")
    const ids = plan.upcoming_assessments.map((a) => a.id)
    expect(ids).toContain("near")
    expect(ids).toContain("undated")
    expect(ids).not.toContain("far")
    // dated first (localeCompare with "9999" sentinel), undated last
    expect(ids[ids.length - 1]).toBe("undated")
    expect(plan.upcoming_assessments.find((a) => a.id === "undated")?.days_until).toBeNull()
  })

  it("resolves 'Semana N' via term_start: lands in this_week + gets days_until", async () => {
    // term_start Monday 2026-06-15 → Semana 3 = 2026-06-29 (this week's Monday)
    listAgendaByUser.mockResolvedValue([
      ev({
        id: "wk-class",
        event_type: "class",
        event_date: null,
        week_label: "Semana 3",
        term_start: "2026-06-15",
      }),
      ev({
        id: "wk-quiz",
        event_type: "quiz",
        event_date: null,
        week_label: "Semana 4", // → 2026-07-06, 5 days out
        term_start: "2026-06-15",
      }),
      ev({
        id: "wk-past",
        event_type: "quiz",
        event_date: null,
        week_label: "Semana 1", // → 2026-06-15, already past → dropped
        term_start: "2026-06-15",
      }),
    ])
    const plan = await RecommendationService.getWeeklyPlan("u1")
    expect(plan.this_week_topics.map((e) => e.id)).toEqual(["wk-class"])
    expect(plan.this_week_topics[0].event_date).toBe("2026-06-29")
    const ids = plan.upcoming_assessments.map((a) => a.id)
    expect(ids).toContain("wk-quiz")
    expect(ids).not.toContain("wk-past")
    expect(plan.upcoming_assessments.find((a) => a.id === "wk-quiz")?.days_until).toBe(5)
  })

  it("no matching topic → empty review_first (no crash)", async () => {
    listAgendaByUser.mockResolvedValue([
      ev({ id: "q1", event_type: "quiz", title: "Parcial 1", event_date: "2026-07-03" }),
    ])
    listUserTopicsWithPrereqs.mockResolvedValue([
      { syllabus_id: "s1", label: "Matrices", prereqs: ["Vectores"] },
    ])
    const plan = await RecommendationService.getWeeklyPlan("u1")
    expect(plan.upcoming_assessments[0].review_first).toEqual([])
  })
})
