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
vi.mock("@/lib/server/services/worker-trigger", () => ({ triggerIngestionWorker: vi.fn() }))
vi.mock("@/lib/server/services/document.service", () => ({
  DocumentService: { processUpload: vi.fn() },
}))

import { requireAuth, getAuthedUser, ApiErrorResponse } from "@/lib/server/utils/auth-helpers"
import { checkRateLimit } from "@/lib/rate-limit"
import { DocumentService } from "@/lib/server/services/document.service"
import { triggerIngestionWorker } from "@/lib/server/services/worker-trigger"
import { POST } from "../app/api/upload/route"

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

const fileReq = (withFile = true) => {
  const fd = new FormData()
  if (withFile)
    fd.append(
      "file",
      new File([new Uint8Array([1, 2, 3])], "syllabus.pdf", { type: "application/pdf" }),
    )
  return new Request("http://t/api/upload", { method: "POST", body: fd })
}
const emptyReq = () =>
  new Request("http://t/api/upload", { method: "POST", body: JSON.stringify({}) })

beforeEach(() => {
  vi.clearAllMocks()
  okRate()
})

describe("POST /api/upload", () => {
  it("401 when unauthenticated", async () => {
    anon()
    const res = await POST(fileReq())
    expect(res.status).toBe(401)
    expect(DocumentService.processUpload).not.toHaveBeenCalled()
  })

  it("400 when no form data", async () => {
    asUser()
    const res = await POST(emptyReq())
    expect(res.status).toBe(400)
  })

  it("400 when no file in form data", async () => {
    asUser()
    const res = await POST(fileReq(false))
    expect(res.status).toBe(400)
  })

  it("201 on success; processes upload and kicks worker", async () => {
    asUser()
    vi.mocked(DocumentService.processUpload).mockResolvedValue({
      id: "up1",
      original_filename: "syllabus.pdf",
      jobId: "j1",
    } as any)
    const res = await POST(fileReq())
    expect(res.status).toBe(201)
    expect(DocumentService.processUpload).toHaveBeenCalled()
    expect(triggerIngestionWorker).toHaveBeenCalled()
    const body = await res.json()
    expect(body.syllabus_id).toBe("up1")
  })

  it("propagates ApiErrorResponse from the service (e.g. non-PDF → 400)", async () => {
    asUser()
    vi.mocked(DocumentService.processUpload).mockRejectedValue(
      new ApiErrorResponse("Only PDF files are allowed.", 400),
    )
    const res = await POST(fileReq())
    expect(res.status).toBe(400)
    expect(triggerIngestionWorker).not.toHaveBeenCalled()
  })
})
