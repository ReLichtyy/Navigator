import { describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  courseSelectionHref,
  LAST_COURSE_SELECTION_KEY,
  readLastCourseSelection,
  resolveInitialCourseSelection,
  selectAndPersistCourse,
  writeLastCourseSelection,
} from "@/lib/ui/last-course-selection"

describe("last course selection", () => {
  it("prefers a valid deep link over the stored course", () => {
    expect(resolveInitialCourseSelection(["course-1", "course-2"], "course-2", "course-1")).toBe(
      "course-2",
    )
  })

  it("restores the stored course when it still exists", () => {
    expect(resolveInitialCourseSelection(["__none__", "course-1"], null, "course-1")).toBe(
      "course-1",
    )
  })

  it("falls back safely when the stored course was deleted", () => {
    expect(resolveInitialCourseSelection(["course-2", "__none__"], null, "course-1")).toBe(
      "course-2",
    )
  })

  it("persists and reads the selected key", () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    }

    writeLastCourseSelection("course-1", storage)

    expect(storage.setItem).toHaveBeenCalledWith(LAST_COURSE_SELECTION_KEY, "course-1")
    expect(readLastCourseSelection(storage)).toBe("course-1")
  })

  it("treats unavailable browser storage as a non-fatal miss", () => {
    const storage = {
      getItem: vi.fn(() => {
        throw new Error("blocked")
      }),
    }

    expect(readLastCourseSelection(storage)).toBeNull()
  })

  it("persists a user selection before exposing it to navigation", () => {
    const order: string[] = []
    const storage = {
      setItem: vi.fn(() => order.push("persisted")),
    }

    selectAndPersistCourse("course-2", () => order.push("selected"), storage)

    expect(order).toEqual(["persisted", "selected"])
  })

  it("replaces a stale course deep link so a full reload restores the latest course", () => {
    expect(courseSelectionHref("/mapa", "course=uncategorized-doc", "course-2")).toBe(
      "/mapa?course=course-2",
    )
  })

  it("removes the course deep link when the uncategorized folder is selected", () => {
    expect(courseSelectionHref("/estudio", "course=course-2&mode=quiz", "__none__")).toBe(
      "/estudio?mode=quiz",
    )
  })

  it("is shared by the Study and Mind Map course pickers", () => {
    const studyPage = readFileSync(resolve(process.cwd(), "app/estudio/page.tsx"), "utf8")
    const mapPage = readFileSync(resolve(process.cwd(), "app/mapa/page.tsx"), "utf8")

    for (const page of [studyPage, mapPage]) {
      expect(page).toContain("readLastCourseSelection")
      expect(page).toContain("writeLastCourseSelection")
      expect(page).toContain("resolveInitialCourseSelection")
      expect(page).toContain("selectAndPersistCourse")
      expect(page).toContain("courseSelectionHref")
    }
  })
})
