import { describe, it, expect, beforeEach, vi } from "vitest"

// Capture the args passed to chat.completions.create.
const create = vi.fn()
vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create } }
  },
}))
vi.mock("@/lib/observability/logger", () => ({ logError: vi.fn() }))

import { openaiProvider } from "@/lib/llm/providers/openai"

const okResponse = {
  choices: [{ message: { content: "hi" } }],
  model: "x",
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.OPENAI_API_KEY = "test"
  create.mockResolvedValue(okResponse)
})

const msgs = [{ role: "user" as const, content: "hi" }]

describe("openaiProvider param mapping", () => {
  it("gpt-4o-mini uses temperature + max_tokens", async () => {
    await openaiProvider.chat(msgs, { provider: "openai", model: "gpt-4o-mini", maxTokens: 100 })
    const arg = create.mock.calls[0][0]
    expect(arg.temperature).toBe(0.2)
    expect(arg.max_tokens).toBe(100)
    expect(arg.max_completion_tokens).toBeUndefined()
  })

  it("gpt-5.5 drops temperature and uses max_completion_tokens", async () => {
    await openaiProvider.chat(msgs, { provider: "openai", model: "gpt-5.5", maxTokens: 100 })
    const arg = create.mock.calls[0][0]
    expect(arg.temperature).toBeUndefined()
    expect(arg.max_tokens).toBeUndefined()
    expect(arg.max_completion_tokens).toBe(100)
  })

  it("o3 is treated as next-gen too", async () => {
    await openaiProvider.chat(msgs, { provider: "openai", model: "o3", maxTokens: 50 })
    const arg = create.mock.calls[0][0]
    expect(arg.temperature).toBeUndefined()
    expect(arg.max_completion_tokens).toBe(50)
  })
})
