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

    expect(config).toContain(
      "lg:grid-cols-[minmax(300px,360px)_minmax(0,1fr)]",
    )
    expect(config).toContain("lg:max-h-[calc(100dvh-9rem)]")
    expect(config).toContain("lg:overflow-y-auto")
  })

  it("collapses modes to one column on phones and expands to three on wide screens", () => {
    const config = src("src/components/estudio/study-config.tsx")

    expect(config).toContain("grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3")
  })
})
