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
vi.mock("@/lib/server/services/chat.service", () => ({
  ChatService: { processMessageStream: vi.fn() },
}))

import { requireAuth, getAuthedUser, ApiErrorResponse } from "@/lib/server/utils/auth-helpers"
import { checkRateLimit } from "@/lib/rate-limit"
import { ChatService } from "@/lib/server/services/chat.service"
import { POST } from "../app/api/chat/[chatId]/messages/route"

const params = (chatId: string) => ({ params: Promise.resolve({ chatId }) })
const asUser = (id = "u1", role = "free") => (
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

const req = (body: unknown) =>
  new Request("http://t/api/chat/c1/messages", { method: "POST", body: JSON.stringify(body) })

// A ReadableStream that mimics the real SSE: token deltas then a final metadata event, then [DONE].
function sseStream(chunks: string[]) {
  const enc = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c))
      controller.close()
    },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  okRate()
})

describe("POST /api/chat/[chatId]/messages (SSE)", () => {
  it("401 when unauthenticated", async () => {
    anon()
    const res = await POST(req({ question: "hi" }), params("c1"))
    expect(res.status).toBe(401)
    expect(ChatService.processMessageStream).not.toHaveBeenCalled()
  })

  it("400 on invalid body (missing question)", async () => {
    asUser()
    const res = await POST(req({}), params("c1"))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.answer).toBeNull()
    expect(ChatService.processMessageStream).not.toHaveBeenCalled()
  })

  it("404 when chat is not the caller's (service throws ApiErrorResponse)", async () => {
    asUser()
    vi.mocked(ChatService.processMessageStream).mockRejectedValue(
      new ApiErrorResponse("Chat not found", 404),
    )
    const res = await POST(req({ question: "hi" }), params("c1"))
    expect(res.status).toBe(404)
  })

  it("200 streams SSE with the right headers and a final metadata event", async () => {
    asUser()
    vi.mocked(ChatService.processMessageStream).mockResolvedValue(
      sseStream([
        `data: ${JSON.stringify({ delta: "Hello" })}\n\n`,
        `data: ${JSON.stringify({ delta: " world" })}\n\n`,
        `data: ${JSON.stringify({
          title: "Greeting",
          citations: [{ chunk_id: "k1", page: 2 }],
          provider: "openai",
          model: "gpt-4o-mini",
        })}\n\n`,
        `data: [DONE]\n\n`,
      ]),
    )

    const res = await POST(req({ question: "hi" }), params("c1"))
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("text/event-stream")

    const text = await res.text()
    const events = text
      .split("\n\n")
      .map((l) => l.replace(/^data: /, "").trim())
      .filter(Boolean)

    expect(events[events.length - 1]).toBe("[DONE]")
    const final = JSON.parse(events[events.length - 2])
    expect(final).toMatchObject({
      title: "Greeting",
      provider: "openai",
      model: "gpt-4o-mini",
    })
    expect(final.citations[0]).toMatchObject({ chunk_id: "k1", page: 2 })

    // call wiring: (chatId, userId, role, question)
    expect(ChatService.processMessageStream).toHaveBeenCalledWith("c1", "u1", "free", "hi")
  })
})
