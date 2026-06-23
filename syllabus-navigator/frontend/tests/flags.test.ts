import { describe, it, expect } from "vitest"
import { __testing } from "@/lib/config/flags"

const { resolveProvider, resolveVectorBackend, resolveBool } = __testing

describe("flags.resolveProvider", () => {
  it("defaults to openai when unset", () => {
    expect(resolveProvider(undefined)).toBe("openai")
  })

  it("accepts known providers case/space-insensitively", () => {
    expect(resolveProvider("openrouter")).toBe("openrouter")
    expect(resolveProvider("  OpenRouter  ")).toBe("openrouter")
    expect(resolveProvider("OPENAI")).toBe("openai")
  })

  it("falls back to openai for unknown providers", () => {
    expect(resolveProvider("anthropic")).toBe("openai")
    expect(resolveProvider("")).toBe("openai")
  })
})

describe("flags.resolveVectorBackend", () => {
  it("defaults to pgvector when unset", () => {
    expect(resolveVectorBackend(undefined)).toBe("pgvector")
  })

  it("accepts pgvector and rejects unsupported backends", () => {
    expect(resolveVectorBackend("pgvector")).toBe("pgvector")
    expect(resolveVectorBackend("chroma")).toBe("pgvector")
    expect(resolveVectorBackend("pinecone")).toBe("pgvector")
  })
})

describe("flags.resolveBool", () => {
  it("uses the fallback when unset or blank", () => {
    expect(resolveBool(undefined, true)).toBe(true)
    expect(resolveBool("", false)).toBe(false)
    expect(resolveBool("   ", true)).toBe(true)
  })

  it("treats false/0/off/no (any case) as false", () => {
    for (const v of ["false", "0", "off", "no", "FALSE", "Off"]) {
      expect(resolveBool(v, true)).toBe(false)
    }
  })

  it("treats anything else as true", () => {
    for (const v of ["true", "1", "on", "yes", "enabled"]) {
      expect(resolveBool(v, false)).toBe(true)
    }
  })
})
