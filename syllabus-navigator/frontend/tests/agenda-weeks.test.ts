import { describe, it, expect } from "vitest"
import {
  buildWeekGroups,
  defaultGroupKey,
  coursesMissingTermStart,
  weekStartOf,
  weekRangeLabel,
  isAssessment,
  type WeekEvent,
} from "@/lib/ui/agenda-weeks"

function ev(p: Partial<WeekEvent> & { id: string }): WeekEvent {
  return {
    syllabus_id: "s1",
    course_id: "c1",
    course_name: "Álgebra",
    doc_name: "algebra.pdf",
    course_color: null,
    event_type: "class",
    title: "Tema",
    event_date: null,
    week_label: null,
    weight_percent: null,
    ...p,
  }
}

// Wednesday 2026-07-08 → its week runs Mon 2026-07-06 .. Sun 2026-07-12.
const TODAY = "2026-07-08"

describe("weekStartOf / weekRangeLabel", () => {
  it("anchors a date to the Monday of its week", () => {
    expect(weekStartOf("2026-07-08")).toBe("2026-07-06") // Wed → Mon
    expect(weekStartOf("2026-07-06")).toBe("2026-07-06") // Mon → itself
    expect(weekStartOf("2026-07-12")).toBe("2026-07-06") // Sun → same week
    expect(weekStartOf("not-a-date")).toBeNull()
  })

  it("labels the range, collapsing the month when both ends share it", () => {
    expect(weekRangeLabel("2026-07-06")).toBe("6 – 12 jul")
    expect(weekRangeLabel("2026-09-28")).toBe("28 sep – 4 oct")
  })
})

describe("buildWeekGroups", () => {
  it("groups dated events by their real Mon–Sun week, not by week_label", () => {
    // Both say "Semana 1" but land in different real weeks → two groups.
    const groups = buildWeekGroups(
      [
        ev({ id: "a", event_date: "2026-07-08", week_label: "Semana 1" }),
        ev({ id: "b", event_date: "2026-07-15", week_label: "Semana 1" }),
      ],
      TODAY,
    )
    expect(groups.map((g) => g.key)).toEqual(["w:2026-07-06", "w:2026-07-13"])
    expect(groups[0].label).toBe("6 – 12 jul")
  })

  it("marks the current week and the past ones", () => {
    const groups = buildWeekGroups(
      [
        ev({ id: "past", event_date: "2026-06-30" }),
        ev({ id: "now", event_date: "2026-07-08" }),
        ev({ id: "next", event_date: "2026-07-14" }),
      ],
      TODAY,
    )
    expect(groups.map((g) => [g.isPast, g.isCurrent])).toEqual([
      [true, false],
      [false, true],
      [false, false],
    ])
  })

  it("puts undated events in a per-document group, after the weeks", () => {
    const groups = buildWeekGroups(
      [
        ev({ id: "dated", event_date: "2026-07-08" }),
        ev({ id: "u1", syllabus_id: "s2", doc_name: "redes.pdf", week_label: "Semana 4" }),
        ev({ id: "u2", syllabus_id: "s2", doc_name: "redes.pdf", week_label: "Semana 5" }),
      ],
      TODAY,
    )
    expect(groups.map((g) => g.kind)).toEqual(["week", "doc"])
    const doc = groups[1]
    expect(doc.key).toBe("d:s2")
    expect(doc.label).toBe("redes.pdf")
    expect(doc.items).toHaveLength(2)
  })

  it("collapses identical items (same course + type + title) with a count", () => {
    const groups = buildWeekGroups(
      [
        ev({ id: "1", event_date: "2026-07-08", title: "Matrices" }),
        ev({ id: "2", event_date: "2026-07-09", title: "matrices  ", syllabus_id: "s9" }),
        ev({ id: "3", event_date: "2026-07-09", title: "Vectores" }),
      ],
      TODAY,
    )
    const items = groups[0].items
    expect(items).toHaveLength(2)
    expect(items[0].count).toBe(2) // same course + type + title, two documents
    expect(items[1].count).toBe(1)
  })

  it("keeps items from different courses apart even with the same title", () => {
    const groups = buildWeekGroups(
      [
        ev({ id: "1", event_date: "2026-07-08", title: "Intro", course_id: "c1" }),
        ev({ id: "2", event_date: "2026-07-08", title: "Intro", course_id: "c2" }),
      ],
      TODAY,
    )
    expect(groups[0].items).toHaveLength(2)
  })

  it("counts assessments and topics separately", () => {
    const groups = buildWeekGroups(
      [
        ev({ id: "q", event_date: "2026-07-08", event_type: "quiz", title: "Quiz 1" }),
        ev({ id: "e", event_date: "2026-07-09", event_type: "exam", title: "Parcial" }),
        ev({ id: "t", event_date: "2026-07-09", event_type: "class", title: "Tema 3" }),
      ],
      TODAY,
    )
    expect(groups[0].assessmentCount).toBe(2)
    expect(groups[0].topicCount).toBe(1)
    expect(isAssessment("quiz")).toBe(true)
    expect(isAssessment("class")).toBe(false)
  })
})

describe("defaultGroupKey", () => {
  it("opens the week containing today", () => {
    const groups = buildWeekGroups(
      [ev({ id: "a", event_date: "2026-06-30" }), ev({ id: "b", event_date: "2026-07-08" })],
      TODAY,
    )
    expect(defaultGroupKey(groups)).toBe("w:2026-07-06")
  })

  it("falls back to the next week ahead when today's week has nothing", () => {
    const groups = buildWeekGroups(
      [ev({ id: "a", event_date: "2026-06-30" }), ev({ id: "b", event_date: "2026-07-20" })],
      TODAY,
    )
    expect(defaultGroupKey(groups)).toBe("w:2026-07-20")
  })

  it("falls back to the first group when only undated events exist", () => {
    const groups = buildWeekGroups([ev({ id: "u", week_label: "Semana 2" })], TODAY)
    expect(defaultGroupKey(groups)).toBe("d:s1")
  })
})

describe("coursesMissingTermStart", () => {
  it("lists courses whose 'Semana N' events never got a date", () => {
    const out = coursesMissingTermStart([
      ev({ id: "1", event_date: "2026-07-08" }),
      ev({ id: "2", week_label: "Semana 4", course_name: "Redes" }),
      ev({ id: "3", week_label: "Semana 5", course_name: "Redes" }),
      ev({ id: "4" }), // no date, no label → nothing to anchor
    ])
    expect(out).toEqual(["Redes"])
  })
})
