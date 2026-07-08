import { describe, it, expect } from "vitest"
import { normalizeStudySet, buildDirectives, pickMindMode } from "@/lib/server/rag/study-gen"

const base = {
  flashcards: [{ front: "  Concept  ", back: "  Def  " }],
  quiz: [{ question: "Q?", options: ["a", "b", "c"], answer: 1, explanation: "because" }],
  summary: {
    titulo: "Título",
    temaPrincipal: "Tema principal",
    introduccion: "Intro",
    ideasPrincipales: ["Idea 1"],
    conceptos: [{ termino: "T", definicion: "D" }],
    conclusion: "Conclusión",
  },
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
    const set = normalizeStudySet({
      ...base,
      flashcards: [
        { front: "x", back: "" },
        { front: "a", back: "b" },
      ],
    })!
    expect(set.flashcards).toHaveLength(1)
    expect(set.flashcards[0].front).toBe("a")
  })

  it("clamps an out-of-range quiz answer index into the options range", () => {
    const set = normalizeStudySet({
      ...base,
      quiz: [{ question: "Q", options: ["a", "b"], answer: 9, explanation: "e" }],
    })!
    expect(set.quiz[0].answer).toBe(1) // clamped to last index
  })

  it("drops quiz questions with fewer than 2 options", () => {
    const set = normalizeStudySet({
      ...base,
      quiz: [{ question: "Q", options: ["only"], answer: 0, explanation: "e" }],
    })
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
      summary: {
        titulo: "",
        temaPrincipal: "",
        introduccion: "",
        ideasPrincipales: [],
        conceptos: [],
        conclusion: "",
      },
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
    expect(out).toContain("FOCUS")
    expect(out).toContain("JSON en la Web")
  })

  it("omits FOCUS when topic is blank", () => {
    expect(buildDirectives({ topic: "   " })).not.toContain("FOCUS")
  })

  it("lists weighted topics heaviest-first and emits the WEIGHTED TOPICS block", () => {
    const out = buildDirectives({
      weightedTopics: [
        { label: "Intro", weight: 10 },
        { label: "Vistas 4+1", weight: 40 },
      ],
    })
    expect(out).toContain("WEIGHTED TOPICS")
    // 40% topic must appear before the 10% one
    expect(out.indexOf("Vistas 4+1")).toBeLessThan(out.indexOf("Intro"))
    expect(out).toContain("Vistas 4+1 (40%)")
  })

  it("omits the WEIGHTED TOPICS block when none provided", () => {
    expect(buildDirectives({})).not.toContain("WEIGHTED TOPICS")
  })
})

describe("buildDirectives (output language)", () => {
  it("emits the default study language when none given", () => {
    expect(buildDirectives({})).toContain('OUTPUT LANGUAGE: "es"')
  })

  it("uses an explicit language override", () => {
    expect(buildDirectives({ language: "en" })).toContain('OUTPUT LANGUAGE: "en"')
  })

  it("falls back to the default when the override is blank", () => {
    expect(buildDirectives({ language: "   " })).toContain('OUTPUT LANGUAGE: "es"')
  })
})

describe("normalizeStudySet (Sprint 4: topic + studyGuide)", () => {
  it("carries a quiz topic when present and omits it when absent", () => {
    const withTopic = normalizeStudySet({
      ...base,
      quiz: [
        { question: "Q?", options: ["a", "b"], answer: 0, explanation: "e", topic: " Vistas " },
      ],
    })!
    expect(withTopic.quiz[0].topic).toBe("Vistas")
    expect(normalizeStudySet(base)!.quiz[0].topic).toBeUndefined()
  })

  it("normalizes + weight-sorts the study guide and drops empty sections", () => {
    const set = normalizeStudySet({
      ...base,
      studyGuide: [
        { topic: "Light", weight: 5, points: ["p1"] },
        { topic: "Heavy", weight: 60, points: [" a ", ""] },
        { topic: "Empty", weight: 99, points: [] },
      ],
    })!
    expect(set.studyGuide!.map((s) => s.topic)).toEqual(["Heavy", "Light"]) // sorted, empty dropped
    expect(set.studyGuide![0].points).toEqual(["a"])
  })

  it("leaves studyGuide undefined when not provided", () => {
    expect(normalizeStudySet(base)!.studyGuide).toBeUndefined()
  })
})

describe("pickMindMode", () => {
  it("picks profundidad when a focus topic is given, regardless of weighted topics", () => {
    expect(pickMindMode({ topic: "Vistas 4+1" })).toBe("profundidad")
    expect(
      pickMindMode({
        topic: "Vistas 4+1",
        weightedTopics: [{ label: "A", weight: 10 }, { label: "B", weight: 20 }],
      }),
    ).toBe("profundidad")
  })

  it("picks bloques when there are no weighted topics and no focus", () => {
    expect(pickMindMode({})).toBe("bloques")
    expect(pickMindMode({ weightedTopics: [] })).toBe("bloques")
    expect(pickMindMode({ weightedTopics: [{ label: "   ", weight: 10 }] })).toBe("bloques")
  })

  it("picks ideas for a handful of topics (1-3)", () => {
    expect(pickMindMode({ weightedTopics: [{ label: "A", weight: 10 }] })).toBe("ideas")
    expect(
      pickMindMode({
        weightedTopics: [
          { label: "A", weight: 10 },
          { label: "B", weight: 20 },
          { label: "C", weight: 30 },
        ],
      }),
    ).toBe("ideas")
  })

  it("picks radial for a broad topic list (4+)", () => {
    expect(
      pickMindMode({
        weightedTopics: [
          { label: "A", weight: 10 },
          { label: "B", weight: 20 },
          { label: "C", weight: 30 },
          { label: "D", weight: 40 },
        ],
      }),
    ).toBe("radial")
  })
})
