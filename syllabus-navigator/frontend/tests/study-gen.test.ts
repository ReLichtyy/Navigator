import { describe, it, expect } from "vitest"
import { normalizeStudySet, buildDirectives } from "@/lib/server/rag/study-gen"

const base = {
  flashcards: [{ front: "  Concept  ", back: "  Def  " }],
  quiz: [{ question: "Q?", options: ["a", "b", "c"], answer: 1, explanation: "because" }],
  summary: { intro: "Intro", points: [{ title: "T", body: "B" }] },
  mindmap: { center: "Center", branches: [{ label: "L", items: [" x ", "", "y"] }] },
}

describe("normalizeStudySet", () => {
  it("trims strings and keeps valid items", () => {
    const set = normalizeStudySet(base)!
    expect(set).not.toBeNull()
    expect(set.flashcards[0]).toEqual({ front: "Concept", back: "Def" })
    expect(set.mindmap.branches[0].items).toEqual(["x", "y"]) // empty dropped
  })

  it("drops flashcards missing a side", () => {
    const set = normalizeStudySet({ ...base, flashcards: [{ front: "x", back: "" }, { front: "a", back: "b" }] })!
    expect(set.flashcards).toHaveLength(1)
    expect(set.flashcards[0].front).toBe("a")
  })

  it("clamps an out-of-range quiz answer index into the options range", () => {
    const set = normalizeStudySet({ ...base, quiz: [{ question: "Q", options: ["a", "b"], answer: 9, explanation: "e" }] })!
    expect(set.quiz[0].answer).toBe(1) // clamped to last index
  })

  it("drops quiz questions with fewer than 2 options", () => {
    const set = normalizeStudySet({ ...base, quiz: [{ question: "Q", options: ["only"], answer: 0, explanation: "e" }] })
    // base flashcards/summary still present, but quiz is emptied
    expect(set!.quiz).toHaveLength(0)
  })

  it("returns null on malformed input", () => {
    expect(normalizeStudySet({ nope: true })).toBeNull()
    expect(normalizeStudySet(null)).toBeNull()
  })

  it("returns null when nothing usable was produced", () => {
    const empty = {
      flashcards: [],
      quiz: [],
      summary: { intro: "", points: [] },
      mindmap: { center: "", branches: [] },
    }
    expect(normalizeStudySet(empty)).toBeNull()
  })
})

describe("buildDirectives (difficulty + topic)", () => {
  it("defaults to medium when no difficulty given", () => {
    expect(buildDirectives({})).toContain("DIFFICULTY: MEDIUM")
  })

  it("emits the hard hint for difícil", () => {
    expect(buildDirectives({ difficulty: "dificil" })).toContain("DIFFICULTY: HARD")
  })

  it("adds a FOCUS line with the topic when provided", () => {
    const out = buildDirectives({ difficulty: "facil", topic: "JSON en la Web" })
    expect(out).toContain("DIFFICULTY: EASY")
    expect(out).toContain('FOCUS')
    expect(out).toContain("JSON en la Web")
  })

  it("omits FOCUS when topic is blank", () => {
    expect(buildDirectives({ topic: "   " })).not.toContain("FOCUS")
  })
})
