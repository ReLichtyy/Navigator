import { describe, it, expect } from "vitest"
import {
  parseWeekNumber,
  resolveWeekDate,
  resolveEventWeekDates,
  mondayOf,
} from "@/lib/server/rag/week-date"

describe("parseWeekNumber", () => {
  it("parses the common label shapes", () => {
    expect(parseWeekNumber("Semana 3")).toBe(3)
    expect(parseWeekNumber("semana 03")).toBe(3)
    expect(parseWeekNumber("Week 12")).toBe(12)
    expect(parseWeekNumber("S3")).toBe(3)
    expect(parseWeekNumber("W7")).toBe(7)
    expect(parseWeekNumber("sem. 5")).toBe(5)
    expect(parseWeekNumber(" Semana  #4 ")).toBe(4)
  })

  it("rejects malformed / non-week labels", () => {
    expect(parseWeekNumber("Clase 3")).toBeNull()
    expect(parseWeekNumber("Semana")).toBeNull()
    expect(parseWeekNumber("Semana 0")).toBeNull()
    expect(parseWeekNumber("Semana tres")).toBeNull()
    expect(parseWeekNumber("")).toBeNull()
  })
})

describe("mondayOf (inferred term_start normalization)", () => {
  it("a Monday stays put", () => {
    expect(mondayOf("2026-03-02")).toBe("2026-03-02")
  })

  it("mid-week and Sunday snap back to that week's Monday", () => {
    expect(mondayOf("2026-03-04")).toBe("2026-03-02") // Wednesday
    expect(mondayOf("2026-03-08")).toBe("2026-03-02") // Sunday
  })

  it("snapping crosses month/year boundaries", () => {
    expect(mondayOf("2026-01-01")).toBe("2025-12-29") // Thursday → prior year's Monday
  })

  it("rejects malformed input", () => {
    expect(mondayOf("03/02/2026")).toBeNull()
    expect(mondayOf("")).toBeNull()
  })
})

describe("resolveWeekDate", () => {
  // term_start Monday 2026-03-02
  it("week 1 = term_start itself", () => {
    expect(resolveWeekDate("2026-03-02", "Semana 1")).toBe("2026-03-02")
  })

  it("week N = term_start + (N-1)*7 days (month/year rollover included)", () => {
    expect(resolveWeekDate("2026-03-02", "Semana 3")).toBe("2026-03-16")
    expect(resolveWeekDate("2026-03-02", "Week 5")).toBe("2026-03-30")
    expect(resolveWeekDate("2025-12-22", "S3")).toBe("2026-01-05")
  })

  it("returns null on malformed label or term_start", () => {
    expect(resolveWeekDate("2026-03-02", "sin semana")).toBeNull()
    expect(resolveWeekDate("02/03/2026", "Semana 2")).toBeNull()
    expect(resolveWeekDate("", "Semana 2")).toBeNull()
  })
})

describe("resolveEventWeekDates", () => {
  const base = { description: null as string | null }

  it("fills event_date only when label + term_start exist; sorts dated first", () => {
    const out = resolveEventWeekDates([
      { ...base, id: "a", event_date: null, week_label: "Semana 2", term_start: "2026-03-02" },
      { ...base, id: "b", event_date: "2026-03-04", week_label: null, term_start: "2026-03-02" },
      { ...base, id: "c", event_date: null, week_label: "Semana 9", term_start: null },
      { ...base, id: "d", event_date: null, week_label: null, term_start: "2026-03-02" },
    ])
    expect(out.map((e) => [e.id, e.event_date])).toEqual([
      ["b", "2026-03-04"],
      ["a", "2026-03-09"],
      ["c", null], // no term_start → untouched
      ["d", null], // no label → untouched
    ])
  })

  it("keeps an existing event_date even if a label is also present", () => {
    const out = resolveEventWeekDates([
      {
        ...base,
        id: "x",
        event_date: "2026-04-01",
        week_label: "Semana 2",
        term_start: "2026-03-02",
      },
    ])
    expect(out[0].event_date).toBe("2026-04-01")
  })

  it("unparseable label stays undated", () => {
    const out = resolveEventWeekDates([
      { ...base, id: "x", event_date: null, week_label: "Unidad 2", term_start: "2026-03-02" },
    ])
    expect(out[0].event_date).toBeNull()
  })
})
