import { describe, it, expect } from "vitest"
import { orderDueFirst } from "@/lib/ui/study-cards"

interface Card {
  front: string
}
const key = (c: Card) => c.front.toLowerCase()

const CARDS: Card[] = [{ front: "Alpha" }, { front: "Beta" }, { front: "Gamma" }, { front: "Delta" }]

describe("orderDueFirst (flashcards repaso ordering)", () => {
  it("returns the same array untouched when there are no due keys", () => {
    expect(orderDueFirst(CARDS, undefined, key)).toBe(CARDS)
    expect(orderDueFirst(CARDS, [], key)).toBe(CARDS)
  })

  it("surfaces due cards first", () => {
    const out = orderDueFirst(CARDS, ["gamma"], key)
    expect(out.map((c) => c.front)).toEqual(["Gamma", "Alpha", "Beta", "Delta"])
  })

  it("preserves relative order within due and non-due groups (stable)", () => {
    const out = orderDueFirst(CARDS, ["delta", "beta"], key)
    expect(out.map((c) => c.front)).toEqual(["Beta", "Delta", "Alpha", "Gamma"])
  })

  it("does not mutate the input array", () => {
    const input = [...CARDS]
    orderDueFirst(input, ["delta"], key)
    expect(input.map((c) => c.front)).toEqual(["Alpha", "Beta", "Gamma", "Delta"])
  })

  it("ignores due keys that match no card", () => {
    const out = orderDueFirst(CARDS, ["nope"], key)
    expect(out.map((c) => c.front)).toEqual(["Alpha", "Beta", "Gamma", "Delta"])
  })
})
