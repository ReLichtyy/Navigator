import { describe, it, expect } from "vitest"
import {
  normalizeRecallItems,
  normalizeCaseItems,
  pctToPoints,
  totalScore,
} from "@/lib/server/rag/exam-gen"

describe("normalizeRecallItems", () => {
  it("keeps valid items, trims fields", () => {
    const items = normalizeRecallItems([
      {
        question: "  ¿Qué es X?  ",
        expectedAnswer: " X es... ",
        keyPoints: [" a ", "b"],
        topic: " Tema 1 ",
      },
    ])
    expect(items).toEqual([
      { question: "¿Qué es X?", expectedAnswer: "X es...", keyPoints: ["a", "b"], topic: "Tema 1" },
    ])
  })

  it("drops items missing question, answer or key points", () => {
    expect(
      normalizeRecallItems([
        { question: "", expectedAnswer: "a", keyPoints: ["k"] },
        { question: "q", expectedAnswer: "", keyPoints: ["k"] },
        { question: "q", expectedAnswer: "a", keyPoints: [] },
        { question: "q", expectedAnswer: "a", keyPoints: [1, "  "] },
        null,
        "junk",
      ]),
    ).toEqual([])
  })

  it("returns [] for non-arrays", () => {
    expect(normalizeRecallItems(null)).toEqual([])
    expect(normalizeRecallItems({})).toEqual([])
  })
})

describe("normalizeCaseItems", () => {
  it("keeps valid items and drops incomplete ones", () => {
    const items = normalizeCaseItems([
      { prompt: "Resuelve...", rubric: ["c1", "c2"], modelSolution: "sol", topic: "T" },
      { prompt: "Sin rubrica", rubric: [], modelSolution: "sol" },
      { prompt: "", rubric: ["c"], modelSolution: "sol" },
      { prompt: "Sin solución", rubric: ["c"], modelSolution: "" },
    ])
    expect(items).toEqual([
      { prompt: "Resuelve...", rubric: ["c1", "c2"], modelSolution: "sol", topic: "T" },
    ])
  })
})

describe("pctToPoints", () => {
  it("scales pct onto the item's points, 1 decimal", () => {
    expect(pctToPoints(100, 1)).toBe(1)
    expect(pctToPoints(50, 1.5)).toBe(0.8)
    expect(pctToPoints(75, 4)).toBe(3)
    expect(pctToPoints(33, 6)).toBe(2)
  })

  it("clamps out-of-range and non-finite pct", () => {
    expect(pctToPoints(-5, 4)).toBe(0)
    expect(pctToPoints(250, 4)).toBe(4)
    expect(pctToPoints(NaN, 4)).toBe(0)
  })
})

describe("totalScore", () => {
  it("sums scores and maxes float-safe", () => {
    const { total, maxTotal } = totalScore([
      { score: 0.8, max: 1.5 },
      { score: 0.7, max: 1.5 },
      { score: 3, max: 4 },
    ])
    expect(total).toBe(4.5)
    expect(maxTotal).toBe(7)
  })

  it("handles empty list", () => {
    expect(totalScore([])).toEqual({ total: 0, maxTotal: 0 })
  })
})
