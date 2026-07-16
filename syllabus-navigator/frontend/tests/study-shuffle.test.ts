import { describe, it, expect } from "vitest"
import { shuffleQuizOptions, type QuizQuestion } from "@/lib/server/rag/study-gen"

const q = (options: string[], answer: number): QuizQuestion => ({
  question: "¿Cuál es la correcta?",
  options,
  answer,
  explanation: "porque sí",
})

/** Deterministic rand from a fixed sequence (repeats the last value when exhausted). */
const seqRand = (seq: number[]) => {
  let i = 0
  return () => seq[Math.min(i++, seq.length - 1)]
}

describe("shuffleQuizOptions", () => {
  it("with an injected deterministic rand produces the expected order and remapped answer", () => {
    const original = q(["A", "B", "C", "D"], 0)
    // Fisher-Yates over [0,1,2,3] with rand always 0: j=0 each round →
    // i=3 swaps 0↔3, i=2 swaps (3)↔2 … final order [1,2,3,0].
    const out = shuffleQuizOptions(original, seqRand([0]))
    expect(out.options).toEqual(["B", "C", "D", "A"])
    expect(out.answer).toBe(3)
    expect(out.options[out.answer]).toBe("A")
  })

  it("property: the answer always follows the correct option text and options stay a permutation", () => {
    const seeds = [0.05, 0.2, 0.33, 0.5, 0.77, 0.99]
    const questions = [q(["A", "B"], 1), q(["A", "B", "C"], 2), q(["A", "B", "C", "D", "E"], 0)]
    for (const original of questions) {
      for (const s of seeds) {
        const out = shuffleQuizOptions(original, seqRand([s, (s * 7) % 1, (s * 13) % 1]))
        expect(out.options[out.answer]).toBe(original.options[original.answer])
        expect([...out.options].sort()).toEqual([...original.options].sort())
        expect(out.answer).toBeGreaterThanOrEqual(0)
        expect(out.answer).toBeLessThan(out.options.length)
      }
    }
  })

  it("handles the 2-option and 5-option contract edges", () => {
    const two = shuffleQuizOptions(q(["Sí", "No"], 0), seqRand([0]))
    expect(two.options).toEqual(["No", "Sí"])
    expect(two.answer).toBe(1)

    const five = shuffleQuizOptions(q(["1", "2", "3", "4", "5"], 4), seqRand([0.99]))
    expect(five.options[five.answer]).toBe("5")
    expect(five.options).toHaveLength(5)
  })

  it("does not mutate the original question", () => {
    const original = q(["A", "B", "C"], 1)
    shuffleQuizOptions(original, seqRand([0]))
    expect(original.options).toEqual(["A", "B", "C"])
    expect(original.answer).toBe(1)
  })

  it("with real Math.random the correct answer is not always index 0 across many serves", () => {
    const original = q(["A", "B", "C", "D"], 0)
    const answers = new Set(
      Array.from({ length: 50 }, () => shuffleQuizOptions(original).answer),
    )
    expect(answers.size).toBeGreaterThan(1)
  })

  it("remaps whyNo keys so 'por qué no la tuya' still points at the picked option", () => {
    // order [1,2,3,0] with rand 0 → original idx 1→pos0, 2→pos1, 3→pos2, 0→pos3.
    const original: QuizQuestion = {
      ...q(["A", "B", "C", "D"], 0),
      whyNo: { "1": ["B is wrong"], "3": ["D is wrong"] },
    }
    const out = shuffleQuizOptions(original, seqRand([0]))
    expect(out.options).toEqual(["B", "C", "D", "A"])
    // original option 1 ("B") now sits at index 0; option 3 ("D") at index 2.
    expect(out.whyNo).toEqual({ "0": ["B is wrong"], "2": ["D is wrong"] })
    // the reason keyed to the new index matches the option text it explains.
    expect(out.options[0]).toBe("B")
    expect(out.options[2]).toBe("D")
  })

  it("passes non-mc kinds through untouched (no options to shuffle)", () => {
    const conex: QuizQuestion = {
      question: "Une cada comando",
      options: [],
      answer: 0,
      explanation: "",
      kind: "conex",
      pairs: [{ l: "INSERT", r: "agrega filas" }],
      rightOrder: [0],
    }
    expect(shuffleQuizOptions(conex, seqRand([0]))).toEqual(conex)
  })
})
