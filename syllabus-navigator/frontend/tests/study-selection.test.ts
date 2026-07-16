import { describe, expect, it } from "vitest"
import { defaultCourseScope } from "@/lib/ui/study-selection"

describe("Área de Estudio course selection", () => {
  it("defaults a real course to its whole-course scope", () => {
    expect(defaultCourseScope("course-1", ["pdf-1", "pdf-2"], null)).toEqual({
      kind: "course",
      courseId: "course-1",
    })
  })

  it("honors a document deep link inside the selected course", () => {
    expect(defaultCourseScope("course-1", ["pdf-1", "pdf-2"], "pdf-2")).toEqual({
      kind: "doc",
      docId: "pdf-2",
    })
  })

  it("falls back to the first document for the uncategorized group", () => {
    expect(defaultCourseScope(null, ["pdf-1", "pdf-2"], null)).toEqual({
      kind: "doc",
      docId: "pdf-1",
    })
  })
})
