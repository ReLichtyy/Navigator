import { describe, it, expect } from "vitest"
import { heatFor, stageTier, stageAdvice, topMissedTopics } from "@/lib/ui/quiz-stage-ui"

describe("heatFor (difficulty escalation colour)", () => {
  it("non-difícil stages are always base regardless of boost", () => {
    expect(heatFor("facil", 0)).toBe("base")
    expect(heatFor("medio", 2)).toBe("base")
  })

  it("difícil reads warn at low boost and hot at full boost", () => {
    expect(heatFor("dificil", 0)).toBe("warn")
    expect(heatFor("dificil", 1)).toBe("warn")
    expect(heatFor("dificil", 2)).toBe("hot")
  })
})

describe("stageTier (between-stage result tier)", () => {
  it("≥90% is dominio sólido", () => {
    expect(stageTier(0.9).head).toBe("Dominio sólido")
    expect(stageTier(1).emoji).toBe("🎯")
  })
  it("70–89% is buen ritmo", () => {
    expect(stageTier(0.7).head).toBe("Buen ritmo")
    expect(stageTier(0.89).head).toBe("Buen ritmo")
  })
  it("below 70% is a reforzar", () => {
    expect(stageTier(0.69).head).toBe("A reforzar")
    expect(stageTier(0).emoji).toBe("📚")
  })
})

describe("topMissedTopics (failed-topic tally → advice list)", () => {
  it("orders by fail count desc and caps at the limit", () => {
    const tally = new Map([
      ["Grafos", 1],
      ["Pilas", 3],
      ["Colas", 2],
      ["Árboles", 1],
    ])
    expect(topMissedTopics(tally)).toEqual(["Pilas", "Colas", "Grafos"])
    expect(topMissedTopics(tally, 2)).toEqual(["Pilas", "Colas"])
  })

  it("empty tally yields an empty list", () => {
    expect(topMissedTopics(new Map())).toEqual([])
  })
})

describe("stageAdvice (actionable stage feedback)", () => {
  it("perfect stage congratulates without naming topics", () => {
    expect(stageAdvice(0, ["Pilas"])).toContain("Etapa perfecta")
  })

  it("names the most-failed topics when available", () => {
    const advice = stageAdvice(2, ["Pilas", "Colas"])
    expect(advice).toContain("Pilas, Colas")
    expect(advice).toContain("Repaso")
  })

  it("falls back to the generic Repaso tip when topics are absent", () => {
    expect(stageAdvice(2, [])).toContain("vuelve a tu Repaso")
  })
})
