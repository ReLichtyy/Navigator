import { describe, it, expect } from "vitest"
import { parseCourseCode, courseName, groupByCourse } from "@/lib/ui/course-group"

function up(id: string, name: string, over: Record<string, unknown> = {}) {
  return { id, original_filename: name, status: "processed", graph_status: "ready", created_at: "2026-06-01", ...over } as any
}

describe("parseCourseCode", () => {
  it("extracts and normalizes a leading code", () => {
    expect(parseCourseCode("ISW-524 Diseño.pdf")).toBe("ISW-524")
    expect(parseCourseCode("isw 521 Prog.pdf")).toBe("ISW-521")
  })
  it("finds a code mid-filename", () => {
    expect(parseCourseCode("II-2026 ISW-524 (V) Diseño.pdf")).toBe("II-2026")
  })
  it("returns null when no code", () => {
    expect(parseCourseCode("apuntes generales.pdf")).toBeNull()
  })
})

describe("courseName", () => {
  it("strips code, extension and version noise", () => {
    expect(courseName("ISW-524 Diseño de Arquitectura.pdf", "ISW-524")).toBe("Diseño de Arquitectura")
  })
  it("falls back to filename without extension when stripped empty", () => {
    expect(courseName("ISW-524.pdf", "ISW-524")).toBe("ISW-524")
  })
})

describe("groupByCourse", () => {
  it("groups docs under their parsed code", () => {
    const groups = groupByCourse([
      up("1", "ISW-521 Prog Web.pdf"),
      up("2", "ISW-521 Prog Web parte 2.pdf"),
      up("3", "ISW-524 Arquitectura.pdf"),
    ])
    expect(groups).toHaveLength(2)
    const isw521 = groups.find((g) => g.code === "ISW-521")!
    expect(isw521.docs).toHaveLength(2)
  })

  it("sorts by code and pushes 'Otros' last", () => {
    const groups = groupByCourse([
      up("1", "notas.pdf"),
      up("2", "ISW-524 Arq.pdf"),
      up("3", "ISW-521 Web.pdf"),
    ])
    expect(groups.map((g) => g.key)).toEqual(["ISW-521", "ISW-524", "OTROS"])
    expect(groups[2].name).toBe("Otros")
  })
})
