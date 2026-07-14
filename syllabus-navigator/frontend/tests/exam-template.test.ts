import { describe, it, expect } from "vitest"
import {
  EXAM_TEMPLATES,
  EXAM_TEMPLATE_IDS,
  templateTotal,
  inferTemplate,
  formatCountdown,
} from "@/lib/ui/exam-template"

describe("EXAM_TEMPLATES", () => {
  it("every template sums to exactly 20 points", () => {
    for (const id of EXAM_TEMPLATE_IDS) {
      expect(templateTotal(EXAM_TEMPLATES[id]), id).toBe(20)
    }
  })

  it("every template lasts 20 minutes and has mcq/short/dev sections", () => {
    for (const id of EXAM_TEMPLATE_IDS) {
      const t = EXAM_TEMPLATES[id]
      expect(t.durationSec).toBe(1200)
      expect(t.sections.map((s) => s.kind)).toEqual(["mcq", "short", "dev"])
    }
  })
})

describe("inferTemplate", () => {
  it("picks practico for calculation/science subjects", () => {
    expect(inferTemplate(["calculo"], "MAT-101")).toBe("practico")
    expect(inferTemplate([], "Física General")).toBe("practico")
    expect(inferTemplate(["programacion", "algoritmos"], "CS")).toBe("practico")
  })

  it("picks teorico for humanities/theory subjects", () => {
    expect(inferTemplate(["historia"], "Historia del Perú")).toBe("teorico")
    expect(inferTemplate([], "Filosofía Moderna")).toBe("teorico")
    expect(inferTemplate(["derecho"], "")).toBe("teorico")
  })

  it("matches through accents and case", () => {
    expect(inferTemplate([], "CÁLCULO AVANZADO")).toBe("practico")
    expect(inferTemplate(["Teoría política"], "")).toBe("teorico")
  })

  it("practico wins when both families match", () => {
    expect(inferTemplate(["teoria", "calculo"], "")).toBe("practico")
  })

  it("defaults to mixto with no signal", () => {
    expect(inferTemplate([], "")).toBe("mixto")
    expect(inferTemplate(["arquitectura"], "Curso X")).toBe("mixto")
  })
})

describe("formatCountdown", () => {
  it("formats MM:SS", () => {
    expect(formatCountdown(1200)).toBe("20:00")
    expect(formatCountdown(119)).toBe("01:59")
    expect(formatCountdown(0)).toBe("00:00")
  })

  it("floors negatives and fractions", () => {
    expect(formatCountdown(-5)).toBe("00:00")
    expect(formatCountdown(61.9)).toBe("01:01")
  })
})
