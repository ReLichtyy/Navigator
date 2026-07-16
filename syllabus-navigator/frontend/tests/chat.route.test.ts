import { describe, it, expect, beforeEach, vi } from "vitest"

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
vi.mock("@/lib/cache", () => ({
  cached: (_k: string, _t: number, fn: () => unknown) => fn(),
  invalidatePrefix: vi.fn(),
}))
vi.mock("@/lib/db", () => ({ sql: vi.fn() }))
vi.mock("@/lib/server/repositories/chat.repo", () => ({
  ChatRepository: {
    listChats: vi.fn(),
    createChat: vi.fn(),
    countChats: vi.fn(),
    deleteChat: vi.fn(),
  },
}))
vi.mock("@/lib/server/repositories/course.repo", () => ({
  CourseRepository: { findByIdAndUser: vi.fn() },
}))

import { requireAuth, getAuthedUser, ApiErrorResponse } from "@/lib/server/utils/auth-helpers"
import { checkRateLimit } from "@/lib/rate-limit"
import { sql } from "@/lib/db"
import { ChatRepository } from "@/lib/server/repositories/chat.repo"
import { CourseRepository } from "@/lib/server/repositories/course.repo"
import { DELETE } from "../app/api/chat/[chatId]/route"
import { POST as createChat } from "../app/api/chat/history/route"

const params = (chatId: string) => ({ params: Promise.resolve({ chatId }) })
const session = (id: string, role: string) => (
  vi.mocked(requireAuth).mockResolvedValue({ userId: id, role } as any),
  vi.mocked(getAuthedUser).mockResolvedValue({ userId: id, role } as any)
)
const anon = () => (
  vi.mocked(requireAuth).mockRejectedValue(new ApiErrorResponse("Unauthorized", 401)),
  vi.mocked(getAuthedUser).mockResolvedValue(null as any)
)
const okRate = () =>
  vi
    .mocked(checkRateLimit)
    .mockResolvedValue({ success: true, reset: 0, limit: 0, remaining: 0 } as any)

const jsonReq = (body: unknown) =>
  new Request("http://t/api/chat/history", { method: "POST", body: JSON.stringify(body) })

beforeEach(() => vi.clearAllMocks())

describe("DELETE /api/chat/[chatId] — IDOR fix", () => {
  it("401 when unauthenticated", async () => {
    anon()
    const res = await DELETE(new Request("http://t/x"), params("c1"))
    expect(res.status).toBe(401)
    expect(sql).not.toHaveBeenCalled()
  })

  it("404 when chat not owned (delete scoped by user_id returns no rows)", async () => {
    session("u1", "free")
    vi.mocked(ChatRepository.deleteChat).mockResolvedValue(false)
    const res = await DELETE(new Request("http://t/x"), params("c1"))
    expect(res.status).toBe(404)
    // the repo delete is scoped to the caller's userId
    expect(ChatRepository.deleteChat).toHaveBeenCalledWith("c1", "u1")
  })

  it("204 when owned; deletes and invalidates cache", async () => {
    session("u1", "free")
    vi.mocked(ChatRepository.deleteChat).mockResolvedValue(true)
    const res = await DELETE(new Request("http://t/x"), params("c1"))
    expect(res.status).toBe(204)
  })
})

describe("POST /api/chat/history — guest limit", () => {
  it("401 when unauthenticated", async () => {
    anon()
    const res = await createChat(jsonReq({}))
    expect(res.status).toBe(401)
  })

  it("403 when guest already has 3 chats", async () => {
    session("g1", "guest")
    okRate()
    vi.mocked(ChatRepository.countChats).mockResolvedValue(3)
    const res = await createChat(jsonReq({}))
    expect(res.status).toBe(403)
    expect(ChatRepository.createChat).not.toHaveBeenCalled()
  })

  it("200 when guest under limit; creates chat", async () => {
    session("g1", "guest")
    okRate()
    vi.mocked(ChatRepository.countChats).mockResolvedValue(0)
    vi.mocked(ChatRepository.createChat).mockResolvedValue({ id: "c9" } as any)
    const res = await createChat(jsonReq({}))
    expect(res.status).toBe(200)
    expect(ChatRepository.createChat).toHaveBeenCalledWith("g1", null, null)
  })

  it("creates a persistent course-scoped chat only for an owned course", async () => {
    const courseId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    session("u1", "free")
    okRate()
    vi.mocked(CourseRepository.findByIdAndUser).mockResolvedValue({ id: courseId } as any)
    vi.mocked(ChatRepository.createChat).mockResolvedValue({ id: "chat-course" } as any)

    const res = await createChat(jsonReq({ course_id: courseId }))

    expect(res.status).toBe(200)
    expect(ChatRepository.createChat).toHaveBeenCalledWith("u1", null, courseId)
  })

  it("404 when attempting to bind a chat to another user's course", async () => {
    const courseId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    session("u1", "free")
    okRate()
    vi.mocked(CourseRepository.findByIdAndUser).mockResolvedValue(undefined)

    const res = await createChat(jsonReq({ course_id: courseId }))

    expect(res.status).toBe(404)
    expect(ChatRepository.createChat).not.toHaveBeenCalled()
  })

  it("does not apply the 3-chat cap to non-guest users", async () => {
    session("u1", "free")
    okRate()
    vi.mocked(ChatRepository.createChat).mockResolvedValue({ id: "c10" } as any)
    const res = await createChat(jsonReq({}))
    expect(res.status).toBe(200)
    expect(ChatRepository.countChats).not.toHaveBeenCalled()
  })
})
