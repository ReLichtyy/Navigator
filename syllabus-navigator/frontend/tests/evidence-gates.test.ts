import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/server/rag/agents/critic", () => ({
  critiqueQuiz: vi.fn(),
  critiqueFlashcards: vi.fn(),
}))
vi.mock("@/lib/observability/logger", () => ({ logInfo: vi.fn() }))

import { critiqueQuiz } from "@/lib/server/rag/agents/critic"
import { gateQuiz } from "@/lib/server/rag/eval/gates"

const question = {
  question: "¿Cuánto es 2 + 2?",
  options: ["3", "4"],
  answer: 1,
  explanation: "La suma es cuatro.",
}

describe("fail-closed evidence gates", () => {
  beforeEach(() => vi.clearAllMocks())

  it("does not serve an item when the verifier omits its verdict", async () => {
    vi.mocked(critiqueQuiz).mockResolvedValue([null])
    await expect(gateQuiz([question], "2 + 2 = 4")).resolves.toEqual([])
  })

  it("rejects malformed questions before invoking the verifier", async () => {
    await expect(gateQuiz([{ ...question, answer: 8 }], "2 + 2 = 4")).resolves.toEqual([])
    expect(critiqueQuiz).not.toHaveBeenCalled()
  })
})
