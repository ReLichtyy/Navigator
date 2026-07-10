import { describe, it, expect, beforeEach, vi } from "vitest"

// --- module mocks (no DB, no LLM) ---
vi.mock("@/lib/server/utils/auth-helpers", () => {
  class ApiErrorResponse extends Error {
    status: number
    constructor(message: string, status: number) {
      super(message)
      this.status = status
    }
  }
  return { ApiErrorResponse }
})
vi.mock("@/lib/observability/logger", () => ({ logError: vi.fn(), logInfo: vi.fn() }))
vi.mock("@/lib/server/repositories/document.repo", () => ({
  DocumentRepository: { findByIdAndUser: vi.fn() },
}))
vi.mock("@/lib/server/repositories/course.repo", () => ({
  CourseRepository: { findByIdAndUser: vi.fn() },
}))
vi.mock("@/lib/server/repositories/chunk.repo", () => ({
  ChunkRepository: {
    getConcatenatedText: vi.fn(),
    getConcatenatedTextByCourse: vi.fn(),
    contentFingerprint: vi.fn(),
    contentFingerprintByCourse: vi.fn(),
  },
}))
vi.mock("@/lib/server/repositories/study.repo", () => ({
  StudyRepository: { get: vi.fn(), upsert: vi.fn(), getByCourse: vi.fn(), upsertByCourse: vi.fn() },
}))
vi.mock("@/lib/server/repositories/study-stats.repo", () => ({
  StudyStatsRepository: { recordReview: vi.fn() },
}))
vi.mock("@/lib/server/repositories/graph.repo", () => ({
  GraphRepository: { getGraph: vi.fn() },
}))
vi.mock("@/lib/server/repositories/mastery.repo", () => ({
  MasteryRepository: { listForSyllabus: vi.fn() },
  topicKey: (s: string) => s.toLowerCase(),
}))
vi.mock("@/lib/server/repositories/study-items.repo", () => ({
  StudyItemsRepository: {
    listForStage: vi.fn(),
    countByTypeDifficulty: vi.fn(),
    listDedupeTexts: vi.fn(),
    insertDeduped: vi.fn(),
    listRecent: vi.fn(),
  },
}))
vi.mock("@/lib/server/repositories/quiz-review.repo", () => ({
  QuizReviewRepository: { openItemIds: vi.fn(), add: vi.fn(), listOpen: vi.fn(), resolve: vi.fn() },
}))
vi.mock("@/lib/server/repositories/quiz-seen.repo", () => ({
  QuizSeenRepository: { seenItemIds: vi.fn(), markSeen: vi.fn(), clearForScope: vi.fn() },
}))
vi.mock("@/lib/server/rag/retrieval/hybrid", () => ({ buildContextByTopics: vi.fn() }))
vi.mock("@/lib/server/rag/web-search", () => ({
  webSearchContext: vi.fn(),
  appendWebContext: vi.fn(),
}))
vi.mock("@/lib/server/rag/orchestrator/runner", () => ({ orchestrateStudySet: vi.fn() }))
vi.mock("@/lib/server/rag/orchestrator/router", () => ({
  buildStudyPlan: vi.fn(),
  orderLabelsByPlan: vi.fn(),
}))
vi.mock("@/lib/server/rag/agents/inquisitor", () => ({ inquisitorAgent: vi.fn() }))
vi.mock("@/lib/server/rag/eval/gates", () => ({ gateQuiz: vi.fn() }))
vi.mock("@/lib/llm/embeddings", () => ({ embedTexts: vi.fn() }))
// Generation now lives in the background StudyBankService (own test file); here we
// only exercise getQuizStage's serve/recycle logic, so mock it out entirely.
vi.mock("@/lib/server/services/study-bank.service", () => ({
  StudyBankService: { ensure: vi.fn(), drain: vi.fn(), hasPending: vi.fn() },
}))

import { DocumentRepository } from "@/lib/server/repositories/document.repo"
import { GraphRepository } from "@/lib/server/repositories/graph.repo"
import { MasteryRepository } from "@/lib/server/repositories/mastery.repo"
import { StudyItemsRepository } from "@/lib/server/repositories/study-items.repo"
import { QuizReviewRepository } from "@/lib/server/repositories/quiz-review.repo"
import { QuizSeenRepository } from "@/lib/server/repositories/quiz-seen.repo"
import { buildContextByTopics } from "@/lib/server/rag/retrieval/hybrid"
import { buildStudyPlan, orderLabelsByPlan } from "@/lib/server/rag/orchestrator/router"
import { inquisitorAgent } from "@/lib/server/rag/agents/inquisitor"
import { gateQuiz } from "@/lib/server/rag/eval/gates"
import { embedTexts } from "@/lib/llm/embeddings"
import { StudyBankService } from "@/lib/server/services/study-bank.service"
import { StudyService } from "@/lib/server/services/study.service"
import type { QuizQuestion } from "@/lib/server/rag/study-gen"

const question = (n: number): QuizQuestion => ({
  question: `Q${n}?`,
  options: ["correcta", "d1", "d2", "d3"],
  answer: 0, // generator bias: correct always first
  explanation: "e",
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(DocumentRepository.findByIdAndUser).mockResolvedValue({ id: "s1" } as any)
  vi.mocked(GraphRepository.getGraph).mockResolvedValue({ topics: [], edges: [] } as any)
  vi.mocked(MasteryRepository.listForSyllabus).mockResolvedValue([] as any)
  vi.mocked(QuizReviewRepository.openItemIds).mockResolvedValue([])
  vi.mocked(QuizSeenRepository.seenItemIds).mockResolvedValue([])
  vi.mocked(QuizSeenRepository.clearForScope).mockResolvedValue(undefined)
  vi.mocked(buildStudyPlan).mockResolvedValue({ targets: [] } as any)
  vi.mocked(orderLabelsByPlan).mockReturnValue([])
  vi.mocked(buildContextByTopics).mockResolvedValue("x".repeat(200))
  vi.mocked(StudyItemsRepository.countByTypeDifficulty).mockResolvedValue(0)
  vi.mocked(StudyItemsRepository.listDedupeTexts).mockResolvedValue([])
  vi.mocked(StudyItemsRepository.insertDeduped).mockResolvedValue(undefined as any)
  vi.mocked(gateQuiz).mockImplementation(async (raw: QuizQuestion[]) => raw)
  vi.mocked(embedTexts).mockImplementation(async (texts: string[]) => texts.map(() => [0.1]))
  vi.mocked(inquisitorAgent).mockImplementation(async (_ev, _opts, count = 20) =>
    Array.from({ length: count }, (_, i) => question(i)),
  )
  vi.mocked(StudyBankService.ensure).mockResolvedValue(undefined)
  vi.mocked(StudyBankService.drain).mockResolvedValue({ processed: 0, failed: 0 })
  vi.mocked(StudyBankService.hasPending).mockResolvedValue(false)
})

describe("getQuizStage — bank serving", () => {
  it("cold bank kicks a background fill + drains once, then serves the refilled pool", async () => {
    const bankItem = (i: number) => ({ id: `b${i}`, topicKey: null, payload: question(i) })
    // 1st listForStage: empty (cold) → ensure+drain; 2nd: refilled pool.
    vi.mocked(StudyItemsRepository.listForStage)
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce(Array.from({ length: 15 }, (_, i) => bankItem(i)) as any)

    const stage = await StudyService.getQuizStage("u1", "s1", { stage: 0 })

    // Generation is NOT inline anymore: a fill job is enqueued and one job drained.
    expect(StudyBankService.ensure).toHaveBeenCalledTimes(1)
    expect(StudyBankService.drain).toHaveBeenCalledTimes(1)
    expect(inquisitorAgent).not.toHaveBeenCalled()
    expect(stage.questions).toHaveLength(15)
    expect(stage.generating).toBe(false)
  })

  it("empty bank + a pending fill job → generating flag, no exhaustion", async () => {
    vi.mocked(StudyItemsRepository.listForStage).mockResolvedValue([] as any)
    vi.mocked(StudyBankService.hasPending).mockResolvedValue(true)

    const stage = await StudyService.getQuizStage("u1", "s1", { stage: 0 })

    expect(stage.questions).toHaveLength(0)
    expect(stage.generating).toBe(true)
    expect(stage.exhausted).toBeFalsy()
  })

  it("bank at target but all seen → recycles (clears seen) and serves again", async () => {
    // Pool empty even after drain, nothing pending, but the bank holds items → recycle.
    vi.mocked(StudyItemsRepository.listForStage)
      .mockResolvedValueOnce([] as any) // initial (all excluded as seen)
      .mockResolvedValueOnce([] as any) // after drain
      .mockResolvedValueOnce(
        Array.from({ length: 15 }, (_, i) => ({ id: `b${i}`, topicKey: null, payload: question(i) })) as any,
      ) // after clearForScope
    vi.mocked(StudyItemsRepository.countByTypeDifficulty).mockResolvedValue(70)

    const stage = await StudyService.getQuizStage("u1", "s1", { stage: 0 })

    expect(QuizSeenRepository.clearForScope).toHaveBeenCalledTimes(1)
    expect(stage.questions).toHaveLength(15)
    expect(stage.exhausted).toBeFalsy()
  })

  it("no items at all → exhausted aviso", async () => {
    vi.mocked(StudyItemsRepository.listForStage).mockResolvedValue([] as any)
    vi.mocked(StudyItemsRepository.countByTypeDifficulty).mockResolvedValue(0)

    const stage = await StudyService.getQuizStage("u1", "s1", { stage: 0 })

    expect(stage.questions).toHaveLength(0)
    expect(stage.exhausted).toBe(true)
  })

  it("serves shuffled options: answer stays in range and is not always 0", async () => {
    vi.mocked(StudyItemsRepository.listForStage).mockResolvedValue(
      Array.from({ length: 20 }, (_, i) => ({
        id: `b${i}`,
        topicKey: null,
        payload: question(i),
      })) as any,
    )

    const stage = await StudyService.getQuizStage("u1", "s1", { stage: 0 })

    for (const q of stage.questions) {
      expect(q.answer).toBeGreaterThanOrEqual(0)
      expect(q.answer).toBeLessThan(q.options.length)
      // The remapped answer still points at the correct text.
      expect(q.options[q.answer]).toBe("correcta")
    }
    // 20 questions of 4 options with the bias removed: astronomically unlikely
    // that every shuffle lands the correct option back at index 0 (0.25^20).
    expect(stage.questions.some((q) => q.answer !== 0)).toBe(true)
  })

  it("warm bank costs no LLM call (no generation when the pool is full)", async () => {
    vi.mocked(StudyItemsRepository.listForStage).mockResolvedValue(
      Array.from({ length: 20 }, (_, i) => ({
        id: `b${i}`,
        topicKey: null,
        payload: question(i),
      })) as any,
    )

    await StudyService.getQuizStage("u1", "s1", { stage: 0 })

    expect(inquisitorAgent).not.toHaveBeenCalled()
    expect(gateQuiz).not.toHaveBeenCalled()
  })
})
