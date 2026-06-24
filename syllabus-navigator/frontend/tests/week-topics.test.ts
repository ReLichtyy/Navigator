import { describe, it, expect } from "vitest"
import { pickWeekTopics } from "@/lib/ui/week-topics"

const range = { today: "2026-06-23", weekStart: "2026-06-22", weekEnd: "2026-06-28" }

const ev = (title: string, event_date: string | null) => ({ title, event_date })

describe("pickWeekTopics", () => {
  it("prioritizes events dated within the current week", () => {
    const out = pickWeekTopics(
      [ev("Antiguo", "2026-01-10"), ev("Esta semana", "2026-06-25"), ev("Futuro", "2026-09-01")],
      range,
    )
    expect(out[0]).toBe("Esta semana")
  })

  it("falls back to nearest upcoming when nothing is in the week", () => {
    const out = pickWeekTopics(
      [ev("Lejano", "2026-12-01"), ev("Pronto", "2026-07-02"), ev("Pasado", "2026-01-01")],
      range,
    )
    // nearest upcoming first (Pronto before Lejano), past events last
    expect(out[0]).toBe("Pronto")
    expect(out[1]).toBe("Lejano")
  })

  it("dedupes by title and caps at the limit", () => {
    const out = pickWeekTopics(
      [
        ev("A", "2026-06-25"),
        ev("A", "2026-06-26"),
        ev("B", "2026-06-27"),
        ev("C", "2026-06-28"),
        ev("D", "2026-06-28"),
      ],
      range,
      3,
    )
    expect(out).toEqual(["A", "B", "C"])
  })

  it("returns undated topics when there are no dates/plan", () => {
    const out = pickWeekTopics([ev("Tema X", null), ev("Tema Y", null)], {})
    expect(out).toEqual(["Tema X", "Tema Y"])
  })

  it("returns empty for no events", () => {
    expect(pickWeekTopics([], range)).toEqual([])
  })
})
