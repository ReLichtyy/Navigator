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
  MasteryRepository: { listForScope: vi.fn() },
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
  QuizSeenRepository: {
    seenItemIds: vi.fn(),
    markSeen: vi.fn(),
    clearForScopeDifficulty: vi.fn(),
  },
}))
vi.mock("@/lib/server/utils/user-prefs", () => ({ getUserPrefs: vi.fn() }))
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
import { CourseRepository } from "@/lib/server/repositories/course.repo"
import { StudyStatsRepository } from "@/lib/server/repositories/study-stats.repo"
import { GraphRepository } from "@/lib/server/repositories/graph.repo"
import { MasteryRepository } from "@/lib/server/repositories/mastery.repo"
import { StudyItemsRepository } from "@/lib/server/repositories/study-items.repo"
import { QuizReviewRepository } from "@/lib/server/repositories/quiz-review.repo"
import { QuizSeenRepository } from "@/lib/server/repositories/quiz-seen.repo"
import { getUserPrefs } from "@/lib/server/utils/user-prefs"
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
  vi.mocked(MasteryRepository.listForScope).mockResolvedValue([] as any)
  vi.mocked(QuizReviewRepository.openItemIds).mockResolvedValue([])
  vi.mocked(QuizSeenRepository.seenItemIds).mockResolvedValue([])
  vi.mocked(QuizSeenRepository.clearForScopeDifficulty).mockResolvedValue(undefined)
  // "Adaptativa" by default: no explicit difficulty → mastery drives the ladder.
  vi.mocked(getUserPrefs).mockResolvedValue({ language: "es", profile: { study: {} } } as any)
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

  it("a short but non-empty pool is served immediately — no inline generation", async () => {
    // 5 unseen items, 15 needed. Serving beats blocking: the fill job is enqueued
    // and the client tops up in the background instead of waiting on an LLM call.
    vi.mocked(StudyItemsRepository.listForStage).mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => ({
        id: `b${i}`,
        topicKey: null,
        payload: question(i),
      })) as any,
    )
    vi.mocked(StudyBankService.hasPending).mockResolvedValue(true)

    const stage = await StudyService.getQuizStage("u1", "s1", { stage: 0 })

    expect(StudyBankService.ensure).toHaveBeenCalledTimes(1)
    expect(StudyBankService.drain).not.toHaveBeenCalled()
    expect(stage.questions).toHaveLength(5)
    expect(stage.generating).toBe(true)
  })

  it("drains only THIS scope+difficulty, never another student's bank", async () => {
    vi.mocked(StudyItemsRepository.listForStage).mockResolvedValue([] as any)

    const stage = await StudyService.getQuizStage("u1", "s1", { stage: 0 })

    expect(StudyBankService.drain).toHaveBeenCalledWith(1, {
      scope: { kind: "doc", id: "s1" },
      difficulty: stage.difficulty,
      ownerId: "u1",
    })
  })

  it("bank at target but all seen → recycles that difficulty's seen ledger and serves again", async () => {
    vi.mocked(QuizSeenRepository.seenItemIds).mockResolvedValue(["b0", "b1"])
    // Pool empty even after drain, nothing pending — but dropping the seen ledger
    // surfaces items again → recycle.
    vi.mocked(StudyItemsRepository.listForStage)
      .mockResolvedValueOnce([] as any) // initial (all excluded as seen)
      .mockResolvedValueOnce([] as any) // after drain
      .mockResolvedValueOnce(
        Array.from({ length: 15 }, (_, i) => ({
          id: `b${i}`,
          topicKey: null,
          payload: question(i),
        })) as any,
      ) // re-read honoring only client/review excludes

    const stage = await StudyService.getQuizStage("u1", "s1", { stage: 0 })

    // Scoped to the difficulty — wiping the whole scope would resurrect other rungs.
    expect(QuizSeenRepository.clearForScopeDifficulty).toHaveBeenCalledWith(
      "u1",
      { kind: "doc", id: "s1" },
      stage.difficulty,
    )
    expect(stage.questions).toHaveLength(15)
    expect(stage.exhausted).toBeFalsy()
  })

  it("nothing seen → an empty pool is exhaustion, and the seen ledger is left alone", async () => {
    vi.mocked(StudyItemsRepository.listForStage).mockResolvedValue([] as any)

    const stage = await StudyService.getQuizStage("u1", "s1", { stage: 0 })

    expect(stage.questions).toHaveLength(0)
    expect(stage.exhausted).toBe(true)
    expect(QuizSeenRepository.clearForScopeDifficulty).not.toHaveBeenCalled()
  })

  it("malformed exclude ids are dropped before they reach the uuid[] cast", async () => {
    vi.mocked(StudyItemsRepository.listForStage).mockResolvedValue([] as any)
    const real = "11111111-2222-3333-4444-555555555555"

    await StudyService.getQuizStage("u1", "s1", {
      stage: 0,
      excludeIds: [real, "not-a-uuid", "'; DROP TABLE study_items;--"],
    })

    const excludeArg = vi.mocked(StudyItemsRepository.listForStage).mock.calls[0][4]
    expect(excludeArg).toEqual([real])
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

describe("getQuizStage — difficulty ladder", () => {
  beforeEach(() => {
    vi.mocked(StudyItemsRepository.listForStage).mockResolvedValue(
      Array.from({ length: 20 }, (_, i) => ({
        id: `b${i}`,
        topicKey: null,
        payload: question(i),
      })) as any,
    )
  })

  const at = (stage: number) => StudyService.getQuizStage("u1", "s1", { stage })

  it("the three stages are three DIFFERENT rungs for a fresh student", async () => {
    const ladder = [(await at(0)).difficulty, (await at(1)).difficulty, (await at(2)).difficulty]
    expect(ladder).toEqual(["facil", "medio", "dificil"])
  })

  it("strong mastery raises the floor so stage 0 skips fácil", async () => {
    vi.mocked(MasteryRepository.listForScope).mockResolvedValue([
      { topic_key: "t", confidence: 0.8 },
    ] as any)

    const stage = await at(0)

    expect(stage.difficulty).toBe("medio")
    expect(stage.base).toBe(1)
  })

  it("the Configuración difficulty anchors the ladder (it used to be ignored)", async () => {
    vi.mocked(getUserPrefs).mockResolvedValue({
      language: "es",
      profile: { study: { difficulty: "Difícil" } },
    } as any)

    const stage = await at(0)

    expect(stage.difficulty).toBe("dificil")
    expect(stage.base).toBe(2)
  })

  it("an explicit pref beats mastery: 'Fácil' starts at fácil even for a strong student", async () => {
    vi.mocked(MasteryRepository.listForScope).mockResolvedValue([
      { topic_key: "t", confidence: 0.9 },
    ] as any)
    vi.mocked(getUserPrefs).mockResolvedValue({
      language: "es",
      profile: { study: { difficulty: "Fácil" } },
    } as any)

    expect((await at(0)).difficulty).toBe("facil")
    expect((await at(2)).difficulty).toBe("dificil")
  })

  it("boost accelerates the climb but never exceeds difícil", async () => {
    expect((await StudyService.getQuizStage("u1", "s1", { stage: 0, boost: 1 })).difficulty).toBe(
      "medio",
    )
    expect((await StudyService.getQuizStage("u1", "s1", { stage: 2, boost: 2 })).difficulty).toBe(
      "dificil",
    )
  })
})

describe("whole-course scope — it used to record nothing", () => {
  beforeEach(() => {
    vi.mocked(CourseRepository.findByIdAndUser).mockResolvedValue({ id: "c1" } as any)
    vi.mocked(StudyItemsRepository.listForStage).mockResolvedValue(
      Array.from({ length: 20 }, (_, i) => ({
        id: `b${i}`,
        topicKey: null,
        payload: question(i),
      })) as any,
    )
  })

  it("the course quiz escalates off REAL course mastery (was hardcoded to 0)", async () => {
    vi.mocked(MasteryRepository.listForScope).mockResolvedValue([
      { topic_key: "t", confidence: 0.9 },
    ] as any)

    const stage = await StudyService.getCourseQuizStage("u1", "c1", { stage: 0 })

    expect(MasteryRepository.listForScope).toHaveBeenCalledWith("u1", { kind: "course", id: "c1" })
    expect(stage.base).toBe(1) // strong → skips fácil
    expect(stage.difficulty).toBe("medio")
  })

  it("a flashcard review on course scope reaches the SRS ledger", async () => {
    await StudyService.recordReview("u1", { kind: "course", id: "c1" }, "card-1", true)

    expect(StudyStatsRepository.recordReview).toHaveBeenCalledWith(
      "u1",
      { kind: "course", id: "c1" },
      "card-1",
      true,
    )
  })
})

describe("StudyService.warmBank — generation off the critical path, on a budget", () => {
  beforeEach(() => {
    vi.mocked(StudyBankService.drain).mockResolvedValue({ processed: 1, failed: 0 })
  })

  it("warms only the rung the student is on plus the next one, to a partial target", async () => {
    const { drained, rungs } = await StudyService.warmBank("u1", { kind: "doc", id: "s1" })

    // Fresh student → base fácil. Warming difícil too would pay for questions
    // most students never reach.
    expect(rungs).toEqual(["facil", "medio"])
    expect(StudyBankService.ensure).toHaveBeenCalledTimes(2)
    // WARM_TARGET (30), not the full BANK_TARGET_PER_DIFFICULTY (70).
    expect(vi.mocked(StudyBankService.ensure).mock.calls[0][4]).toBe(30)
    expect(drained).toBe(1) // WARM_BATCHES — one generation per call
  })

  it("a strong student's warm skips fácil entirely", async () => {
    vi.mocked(MasteryRepository.listForScope).mockResolvedValue([
      { topic_key: "t", confidence: 0.8 },
    ] as any)

    const { rungs } = await StudyService.warmBank("u1", { kind: "doc", id: "s1" })

    expect(rungs).toEqual(["medio", "dificil"])
  })

  it("a student pinned to difícil warms that single rung", async () => {
    vi.mocked(getUserPrefs).mockResolvedValue({
      language: "es",
      profile: { study: { difficulty: "Difícil" } },
    } as any)

    const { rungs } = await StudyService.warmBank("u1", { kind: "doc", id: "s1" })

    expect(rungs).toEqual(["dificil"]) // top of the ladder — nothing above to pre-fill
    expect(StudyBankService.ensure).toHaveBeenCalledTimes(1)
  })
})

describe("Repaso", () => {
  it("reshuffles options on serve so the answer's POSITION can't be memorised", async () => {
    const stored = {
      question: "Q?",
      options: ["correcta", "d1", "d2", "d3"],
      answer: 0,
      explanation: "e",
    }
    // The same failed question, served 20 times.
    vi.mocked(QuizReviewRepository.listOpen).mockResolvedValue(
      Array.from({ length: 20 }, () => ({ ...stored })) as any,
    )

    const queue = await StudyService.listQuizReview("u1", { kind: "doc", id: "s1" })

    for (const q of queue) {
      expect(q.options[q.answer]).toBe("correcta") // remapped, never wrong
    }
    expect(queue.some((q) => q.answer !== 0)).toBe(true) // 0.25^20 that this is a fluke
  })
})
