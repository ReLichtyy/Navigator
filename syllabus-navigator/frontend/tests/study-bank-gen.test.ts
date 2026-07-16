import { describe, it, expect, beforeEach, vi } from "vitest"

// --- module mocks (no DB, no LLM) ---
vi.mock("@/lib/observability/logger", () => ({ logError: vi.fn(), logInfo: vi.fn() }))
vi.mock("@/lib/server/repositories/study-items.repo", () => ({
  StudyItemsRepository: {
    countByTypeDifficulty: vi.fn(),
    countByKinds: vi.fn(),
    listDedupeTexts: vi.fn(),
    insertDeduped: vi.fn(),
  },
}))
vi.mock("@/lib/server/repositories/graph.repo", () => ({
  GraphRepository: { getGraph: vi.fn() },
}))
vi.mock("@/lib/server/repositories/chunk.repo", () => ({
  ChunkRepository: { getConcatenatedText: vi.fn(), getConcatenatedTextByCourse: vi.fn() },
}))
vi.mock("@/lib/server/repositories/job.repo", () => ({
  JobRepository: { enqueue: vi.fn(), claimNext: vi.fn(), complete: vi.fn(), fail: vi.fn() },
}))
vi.mock("@/lib/server/repositories/mastery.repo", () => ({ topicKey: (s: string) => s.toLowerCase() }))
vi.mock("@/lib/server/rag/retrieval/hybrid", () => ({ buildContextByTopics: vi.fn() }))
vi.mock("@/lib/server/rag/agents/inquisitor", () => ({ inquisitorAgent: vi.fn() }))
vi.mock("@/lib/server/rag/eval/gates", () => ({ gateQuiz: vi.fn() }))
vi.mock("@/lib/llm/embeddings", () => ({ embedTexts: vi.fn() }))

import { StudyItemsRepository } from "@/lib/server/repositories/study-items.repo"
import { GraphRepository } from "@/lib/server/repositories/graph.repo"
import { JobRepository } from "@/lib/server/repositories/job.repo"
import { buildContextByTopics } from "@/lib/server/rag/retrieval/hybrid"
import { inquisitorAgent } from "@/lib/server/rag/agents/inquisitor"
import { gateQuiz } from "@/lib/server/rag/eval/gates"
import { embedTexts } from "@/lib/llm/embeddings"
import { StudyBankService, JOB_TYPE_STUDY } from "@/lib/server/services/study-bank.service"
import type { QuizQuestion } from "@/lib/server/rag/study-gen"

const question = (n: number): QuizQuestion => ({
  question: `Q${n}?`,
  options: ["correcta", "d1", "d2", "d3"],
  answer: 0,
  explanation: "e",
})

const job = () => ({
  id: "j1",
  type: JOB_TYPE_STUDY,
  status: "processing",
  attempts: 1,
  max_attempts: 3,
  result: null,
  error: null,
  payload: {
    scopeKind: "doc",
    scopeId: "s1",
    difficulty: "medio",
    target: 70,
    dedupeKey: "doc:s1:quiz:medio",
  },
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(GraphRepository.getGraph).mockResolvedValue({ topics: [], edges: [] } as any)
  vi.mocked(buildContextByTopics).mockResolvedValue("x".repeat(200))
  vi.mocked(StudyItemsRepository.listDedupeTexts).mockResolvedValue([])
  // Alt kinds already at their floor by default → ensure/drain behave as before.
  vi.mocked(StudyItemsRepository.countByKinds).mockResolvedValue(8)
  vi.mocked(StudyItemsRepository.insertDeduped).mockResolvedValue(18 as any)
  vi.mocked(gateQuiz).mockImplementation(async (raw: QuizQuestion[]) => raw)
  vi.mocked(embedTexts).mockImplementation(async (texts: string[]) => texts.map(() => [0.1]))
  vi.mocked(inquisitorAgent).mockImplementation(async (_ev, _opts, count = 20) =>
    Array.from({ length: count }, (_, i) => question(i)),
  )
  vi.mocked(JobRepository.complete).mockResolvedValue(undefined)
  vi.mocked(JobRepository.enqueue).mockResolvedValue("j2")
})

describe("StudyBankService.drain — background quiz generation", () => {
  it("splits an 18-item batch into 3 parallel gen→gate chains of 6 and persists once", async () => {
    vi.mocked(JobRepository.claimNext)
      .mockResolvedValueOnce(job() as any)
      .mockResolvedValueOnce(null)
    // Under target before, still under after (added 18 < 70) → re-enqueues to continue.
    vi.mocked(StudyItemsRepository.countByTypeDifficulty).mockResolvedValue(0)

    const tally = await StudyBankService.drain(1)

    expect(inquisitorAgent).toHaveBeenCalledTimes(3)
    for (const call of vi.mocked(inquisitorAgent).mock.calls) expect(call[2]).toBe(6)
    expect(gateQuiz).toHaveBeenCalledTimes(3)
    expect(StudyItemsRepository.insertDeduped).toHaveBeenCalledTimes(1)
    const inserted = vi.mocked(StudyItemsRepository.insertDeduped).mock.calls[0][1] as unknown[]
    expect(inserted).toHaveLength(18)
    expect(tally.processed).toBe(1)
    // Still below target after adding → job re-enqueued for the next tick.
    expect(JobRepository.enqueue).toHaveBeenCalledTimes(1)
  })

  it("stops re-enqueuing once the bank reaches target", async () => {
    vi.mocked(JobRepository.claimNext)
      .mockResolvedValueOnce(job() as any)
      .mockResolvedValueOnce(null)
    // Already at target → the job completes without generating or re-enqueuing.
    vi.mocked(StudyItemsRepository.countByTypeDifficulty).mockResolvedValue(70)

    await StudyBankService.drain(1)

    expect(inquisitorAgent).not.toHaveBeenCalled()
    expect(JobRepository.enqueue).not.toHaveBeenCalled()
  })

  it("ensure enqueues a fill job when below target (dedupe key set)", async () => {
    vi.mocked(StudyItemsRepository.countByTypeDifficulty).mockResolvedValue(10)

    await StudyBankService.ensure({ kind: "doc", id: "s1" }, "medio")

    expect(JobRepository.enqueue).toHaveBeenCalledTimes(1)
    const [type, payload, opts] = vi.mocked(JobRepository.enqueue).mock.calls[0]
    expect(type).toBe(JOB_TYPE_STUDY)
    expect((payload as any).dedupeKey).toBe("doc:s1:quiz:medio")
    expect((opts as any).dedupeKey).toBe("doc:s1:quiz:medio")
  })

  it("ensure is a no-op at/above target", async () => {
    vi.mocked(StudyItemsRepository.countByTypeDifficulty).mockResolvedValue(70)

    await StudyBankService.ensure({ kind: "doc", id: "s1" }, "medio")

    expect(JobRepository.enqueue).not.toHaveBeenCalled()
  })
})
