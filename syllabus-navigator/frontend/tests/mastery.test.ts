import { describe, it, expect } from "vitest"
import { topicKey } from "@/lib/server/repositories/mastery.repo"

describe("topicKey (mastery ledger normalization)", () => {
  it("lowercases, trims and collapses whitespace", () => {
    expect(topicKey("  Vistas   4+1 ")).toBe("vistas 4+1")
    expect(topicKey("RECURSIÓN")).toBe("recursión")
  })

  it("maps differently-cased/spaced labels to the same key", () => {
    expect(topicKey("Bases de Datos")).toBe(topicKey("  bases  de datos "))
  })

  it("caps the key length", () => {
    expect(topicKey("x".repeat(500)).length).toBe(160)
  })
})
