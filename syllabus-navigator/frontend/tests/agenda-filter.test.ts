import { describe, it, expect } from "vitest"
import {
  buildFacets,
  applyFilter,
  courseKey,
  toggle,
  pruneFilter,
  isFilterActive,
  EMPTY_FILTER,
  type FilterableEvent,
} from "@/lib/ui/agenda-filter"

function ev(p: Partial<FilterableEvent>): FilterableEvent {
  return {
    syllabus_id: "s1",
    course_id: "c1",
    course_name: "Álgebra",
    doc_name: "algebra.pdf",
    event_type: "quiz",
    ...p,
  }
}

const EVENTS: FilterableEvent[] = [
  ev({ syllabus_id: "s1", course_id: "c1", course_name: "Álgebra", event_type: "quiz" }),
  ev({ syllabus_id: "s1", course_id: "c1", course_name: "Álgebra", event_type: "exam" }),
  ev({
    syllabus_id: "s2",
    course_id: "c2",
    course_name: "Redes",
    doc_name: "redes.pdf",
    event_type: "quiz",
  }),
  // Not filed into a course yet → grouped by its own document.
  ev({
    syllabus_id: "s3",
    course_id: null,
    course_name: "suelto.pdf",
    doc_name: "suelto.pdf",
    event_type: "class",
  }),
]

describe("courseKey", () => {
  it("uses the course id when the doc is filed into a course", () => {
    expect(courseKey(EVENTS[0])).toBe("c1")
  })

  it("falls back to the document for docs with no course", () => {
    expect(courseKey(EVENTS[3])).toBe("doc:s3")
  })
})

describe("buildFacets", () => {
  it("tallies courses, documents and types with counts", () => {
    const f = buildFacets(EVENTS)
    expect(f.courses.map((c) => [c.key, c.count])).toEqual([
      ["c1", 2],
      ["c2", 1],
      ["doc:s3", 1],
    ])
    expect(f.docs.map((d) => d.key).sort()).toEqual(["s1", "s2", "s3"])
    expect(f.types.find((t) => t.key === "quiz")?.count).toBe(2)
  })
})

describe("applyFilter", () => {
  it("returns everything when no facet is selected", () => {
    expect(applyFilter(EVENTS, EMPTY_FILTER)).toHaveLength(4)
  })

  it("ORs within a facet", () => {
    const out = applyFilter(EVENTS, { ...EMPTY_FILTER, types: ["quiz", "exam"] })
    expect(out).toHaveLength(3)
  })

  it("ANDs across facets", () => {
    const out = applyFilter(EVENTS, { courses: ["c1"], docs: [], types: ["exam"] })
    expect(out).toHaveLength(1)
    expect(out[0].event_type).toBe("exam")
  })

  it("filters by source document", () => {
    expect(applyFilter(EVENTS, { ...EMPTY_FILTER, docs: ["s2"] })).toHaveLength(1)
  })

  it("yields nothing when the facets don't intersect", () => {
    expect(applyFilter(EVENTS, { courses: ["c2"], docs: ["s1"], types: [] })).toHaveLength(0)
  })
})

describe("toggle / isFilterActive", () => {
  it("adds then removes a key", () => {
    expect(toggle([], "c1")).toEqual(["c1"])
    expect(toggle(["c1", "c2"], "c1")).toEqual(["c2"])
  })

  it("reports an empty filter as inactive", () => {
    expect(isFilterActive(EMPTY_FILTER)).toBe(false)
    expect(isFilterActive({ ...EMPTY_FILTER, docs: ["s1"] })).toBe(true)
  })
})

describe("pruneFilter", () => {
  it("drops selections whose course/doc no longer exists", () => {
    const stale = { courses: ["c1", "gone"], docs: ["s9"], types: ["quiz"] }
    expect(pruneFilter(stale, EVENTS)).toEqual({ courses: ["c1"], docs: [], types: ["quiz"] })
  })
})
