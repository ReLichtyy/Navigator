import { describe, it, expect } from "vitest"
import {
  COURSE_COLOR_HEXES,
  isCourseColor,
  colorIndexFor,
  resolveCourseColor,
  randomCourseColor,
  colorTint,
} from "@/lib/ui/course-color"

describe("isCourseColor", () => {
  it("accepts #RRGGBB and rejects anything else", () => {
    expect(isCourseColor("#3FBF84")).toBe(true)
    expect(isCourseColor("#fff")).toBe(false)
    expect(isCourseColor("rojo")).toBe(false)
    expect(isCourseColor(null)).toBe(false)
    expect(isCourseColor(undefined)).toBe(false)
  })
})

describe("resolveCourseColor", () => {
  it("uses the course's own color when it has one", () => {
    expect(resolveCourseColor("#f472b6", "c1")).toBe("#f472b6")
  })

  it("falls back to a stable palette color when the course has none", () => {
    const a = resolveCourseColor(null, "c1")
    const b = resolveCourseColor(null, "c1")
    expect(a).toBe(b)
    expect(COURSE_COLOR_HEXES).toContain(a)
  })

  it("ignores a malformed stored color instead of rendering it", () => {
    expect(resolveCourseColor("azul", "c1")).toBe(COURSE_COLOR_HEXES[colorIndexFor("c1")])
  })
})

describe("randomCourseColor", () => {
  it("prefers a color no other course is using", () => {
    const used = COURSE_COLOR_HEXES.slice(0, COURSE_COLOR_HEXES.length - 1)
    expect(randomCourseColor(used)).toBe(COURSE_COLOR_HEXES[COURSE_COLOR_HEXES.length - 1])
  })

  it("still returns a palette color when every color is taken", () => {
    expect(COURSE_COLOR_HEXES).toContain(randomCourseColor(COURSE_COLOR_HEXES))
  })
})

describe("colorTint", () => {
  it("appends the alpha suffix", () => {
    expect(colorTint("#3FBF84")).toBe("#3FBF8422")
  })
})
