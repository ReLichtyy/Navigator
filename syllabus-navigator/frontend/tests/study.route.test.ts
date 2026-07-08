import { describe, it, expect, beforeEach, vi } from "vitest"

// --- module mocks (no DB, no real auth, no LLM) ---
vi.mock("@/lib/server/utils/auth-helpers", () => {
  class ApiErrorResponse extends Error {
    status: number
    constructor(message: string, status: number) {
      super(message)
      this.status = status
      this.name = "ApiErrorResponse"
    }
  }
  return {
    requireAuth: vi.fn(),
    getAuthedUser: vi.fn(),
    requireRateLimit: vi.fn(),
    ApiErrorResponse,
  }
})
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn() }))
vi.mock("@/lib/observability/logger", () => ({ logError: vi.fn(), logInfo: vi.fn() }))
vi.mock("@/lib/server/services/study.service", () => ({
  StudyService: { getStudySet: vi.fn() },
}))

import { requireAuth, getAuthedUser, ApiErrorResponse } from "@/lib/server/utils/auth-helpers"
import { StudyService } from "@/lib/server/services/study.service"
import { GET } from "../app/api/study/[syllabusId]/route"

const params = (syllabusId: string) => ({ params: Promise.resolve({ syllabusId }) })
const asUser = (id = "u1", role = "free") => (
  vi.mocked(requireAuth).mockResolvedValue({ userId: id, role } as any),
  vi.mocked(getAuthedUser).mockResolvedValue({ userId: id, role } as any)
)
const anon = () => (
  vi.mocked(requireAuth).mockRejectedValue(new ApiErrorResponse("Unauthorized", 401)),
  vi.mocked(getAuthedUser).mockResolvedValue(null as any)
)
const req = (url = "http://t/api/study/s1") => new Request(url)

const SET = {
  flashcards: [{ front: "Q", back: "A" }],
  quiz: [{ question: "?", options: ["a", "b"], answer: 1, explanation: "x" }],
  summary: {
    titulo: "T",
    temaPrincipal: "TP",
    introduccion: "i",
    ideasPrincipales: ["idea"],
    conceptos: [{ termino: "t", definicion: "d" }],
    conclusion: "c",
  },
  mindmap: { center: "C", branches: [{ label: "L", items: ["x"] }] },
}

beforeEach(() => vi.clearAllMocks())

describe("GET /api/study/[syllabusId]", () => {
  it("401 when unauthenticated", async () => {
    anon()
    const res = await GET(req(), params("s1"))
    expect(res.status).toBe(401)
    expect(StudyService.getStudySet).not.toHaveBeenCalled()
  })

  it("404 when the syllabus is not owned (service throws ApiErrorResponse)", async () => {
    asUser()
    vi.mocked(StudyService.getStudySet).mockRejectedValue(
      new ApiErrorResponse("Syllabus not found", 404),
    )
    const res = await GET(req(), params("s1"))
    expect(res.status).toBe(404)
    expect(StudyService.getStudySet).toHaveBeenCalledWith(
      "u1",
      "s1",
      expect.objectContaining({ refresh: false }),
    )
  })

  it("200 returns the study set with the syllabus id", async () => {
    asUser()
    vi.mocked(StudyService.getStudySet).mockResolvedValue(SET as any)
    const res = await GET(req(), params("s1"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ syllabus_id: "s1", quiz: SET.quiz, flashcards: SET.flashcards })
  })

  it("passes refresh=1 through to the service", async () => {
    asUser()
    vi.mocked(StudyService.getStudySet).mockResolvedValue(SET as any)
    await GET(req("http://t/api/study/s1?refresh=1"), params("s1"))
    expect(StudyService.getStudySet).toHaveBeenCalledWith(
      "u1",
      "s1",
      expect.objectContaining({ refresh: true }),
    )
  })

  it("passes difficulty + topic through to the service", async () => {
    asUser()
    vi.mocked(StudyService.getStudySet).mockResolvedValue(SET as any)
    await GET(req("http://t/api/study/s1?difficulty=dificil&topic=JSON%20Web"), params("s1"))
    expect(StudyService.getStudySet).toHaveBeenCalledWith(
      "u1",
      "s1",
      expect.objectContaining({ refresh: false, difficulty: "dificil", topic: "JSON Web" }),
    )
  })

  it("ignores an invalid difficulty value", async () => {
    asUser()
    vi.mocked(StudyService.getStudySet).mockResolvedValue(SET as any)
    await GET(req("http://t/api/study/s1?difficulty=imposible"), params("s1"))
    const call = vi.mocked(StudyService.getStudySet).mock.calls[0][2] as { difficulty?: string }
    expect(call.difficulty).toBeUndefined()
  })

  it("409 when there is not enough material (typed error, no leak)", async () => {
    asUser()
    vi.mocked(StudyService.getStudySet).mockRejectedValue(
      new ApiErrorResponse("This course doesn't have enough indexed material yet.", 409),
    )
    const res = await GET(req(), params("s1"))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toContain("enough indexed material")
  })

  it("500 with a generic message on an unexpected error (no internal leak)", async () => {
    asUser()
    vi.mocked(StudyService.getStudySet).mockRejectedValue(new Error("boom: secret stack"))
    const res = await GET(req(), params("s1"))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe("Failed to load study material.")
  })
})
