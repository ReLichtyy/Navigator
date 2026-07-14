import { describe, it, expect } from "vitest"
import { todayISO, normalizeTimeZone } from "@/lib/server/utils/today"

// 2026-07-13 is a Monday. At 00:30 UTC the server is already on the 13th while
// a UTC-5 student is still on Sunday the 12th — the case that used to slide the
// whole agenda a day (and, on Sundays, a whole week) ahead.
const SUNDAY_NIGHT_IN_LIMA = new Date("2026-07-13T00:30:00Z")

describe("todayISO", () => {
  it("gives the student's day, not the server's UTC day", () => {
    expect(todayISO("America/Lima", SUNDAY_NIGHT_IN_LIMA)).toBe("2026-07-12")
    expect(todayISO("UTC", SUNDAY_NIGHT_IN_LIMA)).toBe("2026-07-13")
  })

  it("works east of UTC too", () => {
    // 23:30 UTC on the 12th is already the 13th in Tokyo (UTC+9).
    const d = new Date("2026-07-12T23:30:00Z")
    expect(todayISO("Asia/Tokyo", d)).toBe("2026-07-13")
    expect(todayISO("America/Lima", d)).toBe("2026-07-12")
  })

  it("falls back to the app zone when the client sent no/garbage tz", () => {
    // APP_TIMEZONE is unset in tests → America/Lima.
    expect(todayISO(undefined, SUNDAY_NIGHT_IN_LIMA)).toBe("2026-07-12")
    expect(todayISO("Not/AZone", SUNDAY_NIGHT_IN_LIMA)).toBe("2026-07-12")
    expect(todayISO("", SUNDAY_NIGHT_IN_LIMA)).toBe("2026-07-12")
  })

  it("always formats as ISO yyyy-mm-dd", () => {
    expect(todayISO("America/Lima", new Date("2026-01-05T12:00:00Z"))).toBe("2026-01-05")
  })
})

describe("normalizeTimeZone", () => {
  it("accepts a real IANA zone", () => {
    expect(normalizeTimeZone("America/Lima")).toBe("America/Lima")
  })
  it("rejects unknown, empty and oversized values", () => {
    expect(normalizeTimeZone("Mars/Olympus")).toBeNull()
    expect(normalizeTimeZone("")).toBeNull()
    expect(normalizeTimeZone(null)).toBeNull()
    expect(normalizeTimeZone("x".repeat(65))).toBeNull()
  })
})
