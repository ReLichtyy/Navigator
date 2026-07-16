import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

function src(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8")
}

describe("Área de Estudio responsive layout", () => {
  it("uses the available desktop width without becoming unbounded", () => {
    const page = src("app/estudio/page.tsx")

    expect(page).toContain('mode === "menu" ? "w-full max-w-[1480px]" : "max-w-3xl"')
    expect(page).toContain("lg:px-8")
  })

  it("keeps material readable while the study panel grows", () => {
    const config = src("src/components/estudio/study-config.tsx")

    expect(config).toContain("lg:grid-cols-[minmax(300px,360px)_minmax(0,1fr)]")
    expect(config).toContain("lg:max-h-[calc(100dvh-9rem)]")
    expect(config).toContain("lg:overflow-y-auto")
  })

  it("presents a single collapsible course picker above optional materials", () => {
    const config = src("src/components/estudio/study-config.tsx")
    const page = src("app/estudio/page.tsx")

    expect(config).toContain("Material de estudio")
    expect(config).toContain("const [coursesOpen, setCoursesOpen]")
    expect(config).toContain('aria-controls="study-course-options"')
    expect(config).toContain('id="study-course-options"')
    expect(config).toContain("Materiales opcionales")
    expect(config).toContain("min-h-11")
    expect(page).toContain("const [selectedCourseKey, setSelectedCourseKey]")
    expect(page).toContain("setSelectedCourseKey(folderKey(g))")
    expect(page).not.toContain("const [selectedKeys, setSelectedKeys]")
  })

  it("collapses modes to one column on phones and expands to three on wide screens", () => {
    const config = src("src/components/estudio/study-config.tsx")

    expect(config).toContain("grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3")
  })
})
