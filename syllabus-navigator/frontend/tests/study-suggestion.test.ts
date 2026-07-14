import { describe, it, expect } from "vitest"
import { pickStudySuggestion } from "@/lib/ui/study-suggestion"

const ev = (event_type: string, event_date: string | null) => ({ event_type, event_date })

describe("pickStudySuggestion", () => {
  it("suggests examen for the nearest upcoming assessment within the horizon", () => {
    const out = pickStudySuggestion(
      [ev("exam", "2026-06-30"), ev("quiz", "2026-06-26"), ev("class", "2026-06-23")],
      "2026-06-23",
      true,
    )
    expect(out).toEqual({ mode: "examen", reason: "en 3 días" })
  })

  it("uses human reasons for today / tomorrow", () => {
    expect(pickStudySuggestion([ev("quiz", "2026-06-23")], "2026-06-23", false)?.reason).toBe("hoy")
    expect(pickStudySuggestion([ev("exam", "2026-06-24")], "2026-06-23", false)?.reason).toBe(
      "mañana",
    )
  })

  it("ignores assessments in the past or beyond the horizon", () => {
    expect(pickStudySuggestion([ev("exam", "2026-06-20")], "2026-06-23", false)).toBeNull()
    expect(pickStudySuggestion([ev("exam", "2026-07-20")], "2026-06-23", false)).toBeNull()
  })

  it("ignores non-assessment event types", () => {
    expect(
      pickStudySuggestion(
        [ev("class", "2026-06-24"), ev("reading", "2026-06-25")],
        "2026-06-23",
        false,
      ),
    ).toBeNull()
  })

  it("falls back to quiz when week topics exist but no assessment", () => {
    expect(pickStudySuggestion([], "2026-06-23", true)).toEqual({
      mode: "quiz",
      reason: "esta semana",
    })
  })

  it("returns null when nothing is relevant", () => {
    expect(pickStudySuggestion([], "2026-06-23", false)).toBeNull()
    expect(pickStudySuggestion([], undefined, false)).toBeNull()
  })
})
