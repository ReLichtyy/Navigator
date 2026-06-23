import { describe, it, expect } from "vitest"
import { streakFromDates } from "@/lib/ui/streak"

describe("streakFromDates", () => {
  it("no reviews → 0", () => {
    expect(streakFromDates([], "2026-06-23")).toBe(0)
  })

  it("counts consecutive days ending today", () => {
    expect(streakFromDates(["2026-06-23", "2026-06-22", "2026-06-21"], "2026-06-23")).toBe(3)
  })

  it("allows the streak to end yesterday (not yet studied today)", () => {
    expect(streakFromDates(["2026-06-22", "2026-06-21"], "2026-06-23")).toBe(2)
  })

  it("breaks on a gap", () => {
    expect(streakFromDates(["2026-06-23", "2026-06-21", "2026-06-20"], "2026-06-23")).toBe(1)
  })

  it("stale streak (older than yesterday) → 0", () => {
    expect(streakFromDates(["2026-06-20", "2026-06-19"], "2026-06-23")).toBe(0)
  })

  it("ignores duplicate dates", () => {
    expect(streakFromDates(["2026-06-23", "2026-06-23", "2026-06-22"], "2026-06-23")).toBe(2)
  })
})
