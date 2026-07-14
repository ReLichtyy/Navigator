import { describe, it, expect } from "vitest"
import { meta, whenLabel, daysBadge, dayMonthLabel, TYPE_META } from "@/lib/ui/agenda-format"

describe("agenda meta()", () => {
  it("maps known types to their badge variant", () => {
    expect(meta("quiz").variant).toBe("warn")
    expect(meta("exam").variant).toBe("error")
    expect(meta("class").variant).toBe("ok")
  })
  it("unknown type → 'other'", () => {
    expect(meta("nope")).toBe(TYPE_META.other)
    expect(meta("nope").label).toBe("Evento")
  })
})

describe("whenLabel()", () => {
  it("prefers event_date", () => {
    expect(whenLabel({ event_date: "2026-06-23", week_label: "S1", date_precision: "exact" })).toBe(
      "2026-06-23",
    )
  })
  it("falls back to week_label", () => {
    expect(whenLabel({ event_date: null, week_label: "Semana 1" })).toBe("Semana 1")
  })
  it("falls back to 'Sin fecha'", () => {
    expect(whenLabel({ event_date: null, week_label: null })).toBe("Sin fecha")
  })
  it("a week-resolved date reads as a week, never as the Monday it landed on", () => {
    expect(
      whenLabel({ event_date: "2026-07-06", week_label: "Semana 5", date_precision: "week" }),
    ).toBe("Semana 5 · sem. 6 jul")
  })
})

describe("dayMonthLabel()", () => {
  it("formats an ISO date", () => expect(dayMonthLabel("2026-07-06")).toBe("6 jul"))
  it("malformed → empty", () => expect(dayMonthLabel("06/07/2026")).toBe(""))
})

describe("daysBadge()", () => {
  it("null → null", () => expect(daysBadge(null)).toBeNull())
  it("negative → Vencido", () => expect(daysBadge(-1)).toBe("Vencido"))
  it("0 → Hoy", () => expect(daysBadge(0)).toBe("Hoy"))
  it("1 → Mañana", () => expect(daysBadge(1)).toBe("Mañana"))
  it("n>1 → En n días", () => expect(daysBadge(5)).toBe("En 5 días"))
  it("week precision → no badge (the day is a placeholder, not the real day)", () => {
    expect(daysBadge(0, "week")).toBeNull()
    expect(daysBadge(3, "week")).toBeNull()
  })
  it("exact precision still badges", () => expect(daysBadge(0, "exact")).toBe("Hoy"))
})
