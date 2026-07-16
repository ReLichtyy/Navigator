import { describe, expect, it } from "vitest"
import { prepareQuickNote } from "@/lib/ui/quick-note"

describe("prepareQuickNote", () => {
  it("separates a persisted title at a colon", () => {
    expect(prepareQuickNote("Parcial: repasar los capítulos 2 y 3", "#3FBF84")).toEqual({
      title: "Parcial",
      body: "repasar los capítulos 2 y 3",
      color: "#3FBF84",
    })
  })

  it("separates a persisted title at an em dash", () => {
    expect(prepareQuickNote("Lecturas — terminar el artículo", "#D8C79A")).toEqual({
      title: "Lecturas",
      body: "terminar el artículo",
      color: "#D8C79A",
    })
  })

  it("keeps an unsplit note body and leaves the title unset", () => {
    expect(prepareQuickNote("Recordar llevar calculadora", "#8FA8E8")).toEqual({
      body: "Recordar llevar calculadora",
      color: "#8FA8E8",
    })
  })
})
