import { describe, it, expect } from "vitest"
import { bucketEventsByDate, courseColorIndex, DOT_HEX } from "@/components/agenda/month-calendar"
import type { ScheduleEventAPI } from "@/lib/api"

function ev(id: string, date: string | null, course = "ISW-524"): ScheduleEventAPI {
  return {
    id,
    syllabus_id: "s1",
    course_id: null,
    course_name: course,
    doc_name: "syllabus.pdf",
    course_color: null,
    event_type: "quiz",
    title: `Event ${id}`,
    description: null,
    event_date: date,
    week_label: null,
    weight_percent: null,
  }
}

describe("bucketEventsByDate", () => {
  it("groups events by their ISO date", () => {
    const out = bucketEventsByDate([
      ev("1", "2026-06-23"),
      ev("2", "2026-06-23"),
      ev("3", "2026-07-03"),
    ])
    expect(out["2026-06-23"]).toHaveLength(2)
    expect(out["2026-07-03"]).toHaveLength(1)
  })

  it("excludes undated and malformed-date events from the grid", () => {
    const out = bucketEventsByDate([ev("1", null), ev("2", "Semana 3"), ev("3", "2026-06-26")])
    expect(Object.keys(out)).toEqual(["2026-06-26"])
  })
})

describe("courseColorIndex", () => {
  it("is stable for the same course name", () => {
    expect(courseColorIndex("ISW-524")).toBe(courseColorIndex("ISW-524"))
  })

  it("returns an index within the palette range", () => {
    for (const n of ["ISW-521", "ISW-522", "ISW-523", "ISW-524", "Math"]) {
      const i = courseColorIndex(n)
      expect(i).toBeGreaterThanOrEqual(0)
      expect(i).toBeLessThan(DOT_HEX.length)
    }
  })
})
