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
vi.mock("@/lib/cache", () => ({ invalidatePrefix: vi.fn() }))
vi.mock("@/lib/server/repositories/document.repo", () => ({
  DocumentRepository: {
    findByIdAndUser: vi.fn(),
    deleteDocument: vi.fn(),
    renameDocument: vi.fn(),
  },
}))

import { requireAuth, getAuthedUser, ApiErrorResponse } from "@/lib/server/utils/auth-helpers"
import { DocumentRepository } from "@/lib/server/repositories/document.repo"
import { DELETE, PATCH } from "../app/api/upload/[id]/route"

const params = (id: string) => ({ params: Promise.resolve({ id }) })
const asUser = (id = "u1", role = "free") => (
  vi.mocked(requireAuth).mockResolvedValue({ userId: id, role } as any),
  vi.mocked(getAuthedUser).mockResolvedValue({ userId: id, role } as any)
)
const anon = () => (
  vi.mocked(requireAuth).mockRejectedValue(new ApiErrorResponse("Unauthorized", 401)),
  vi.mocked(getAuthedUser).mockResolvedValue(null as any)
)
const DOC = { id: "d1", user_id: "u1", original_filename: "f.pdf" }

const req = (body?: unknown) =>
  new Request("http://t/api/upload/d1", {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  })

beforeEach(() => vi.clearAllMocks())

describe("DELETE /api/upload/[id]", () => {
  it("401 when unauthenticated", async () => {
    anon()
    const res = await DELETE(req(), params("d1"))
    expect(res.status).toBe(401)
    expect(DocumentRepository.deleteDocument).not.toHaveBeenCalled()
  })

  it("404 when not owned", async () => {
    asUser()
    vi.mocked(DocumentRepository.findByIdAndUser).mockResolvedValue(undefined)
    const res = await DELETE(req(), params("d1"))
    expect(res.status).toBe(404)
    expect(DocumentRepository.deleteDocument).not.toHaveBeenCalled()
  })

  it("200 deletes scoped by userId (defense-in-depth)", async () => {
    asUser()
    vi.mocked(DocumentRepository.findByIdAndUser).mockResolvedValue(DOC as any)
    const res = await DELETE(req(), params("d1"))
    expect(res.status).toBe(200)
    expect(DocumentRepository.deleteDocument).toHaveBeenCalledWith("d1", "u1")
  })
})

describe("PATCH /api/upload/[id] (rename)", () => {
  it("401 when unauthenticated", async () => {
    anon()
    const res = await PATCH(req({ name: "new" }), params("d1"))
    expect(res.status).toBe(401)
  })

  it("400 on invalid body (empty name)", async () => {
    asUser()
    const res = await PATCH(req({ name: "" }), params("d1"))
    expect(res.status).toBe(400)
  })

  it("404 when not owned", async () => {
    asUser()
    vi.mocked(DocumentRepository.findByIdAndUser).mockResolvedValue(undefined)
    const res = await PATCH(req({ name: "new.pdf" }), params("d1"))
    expect(res.status).toBe(404)
    expect(DocumentRepository.renameDocument).not.toHaveBeenCalled()
  })

  it("200 renames", async () => {
    asUser()
    vi.mocked(DocumentRepository.findByIdAndUser).mockResolvedValue(DOC as any)
    vi.mocked(DocumentRepository.renameDocument).mockResolvedValue({
      ...DOC,
      original_filename: "new.pdf",
    } as any)
    const res = await PATCH(req({ name: "new.pdf" }), params("d1"))
    expect(res.status).toBe(200)
    expect(DocumentRepository.renameDocument).toHaveBeenCalledWith("d1", "u1", "new.pdf")
  })
})
