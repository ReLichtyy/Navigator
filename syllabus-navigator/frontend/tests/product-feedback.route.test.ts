import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/server/utils/auth-helpers", () => {
  class ApiErrorResponse extends Error {
    constructor(
      public message: string,
      public status: number,
    ) {
      super(message)
    }
  }
  return {
    ApiErrorResponse,
    requireProductFeedbackIdentity: vi.fn(),
    requireProductFeedbackRateLimit: vi.fn(),
  }
})
vi.mock("@/lib/server/services/product-feedback.service", () => ({
  submitProductFeedback: vi.fn(),
}))
vi.mock("@/lib/observability/logger", () => ({ logError: vi.fn(), logInfo: vi.fn() }))

import {
  ApiErrorResponse,
  requireProductFeedbackIdentity,
  requireProductFeedbackRateLimit,
} from "@/lib/server/utils/auth-helpers"
import { submitProductFeedback } from "@/lib/server/services/product-feedback.service"
import { POST } from "../app/api/product-feedback/route"

const identity = {
  userId: "b7cb2c79-8f64-44d4-a1d1-af669d8099f8",
  role: "free" as const,
  personName: "Ada Lovelace",
}
const input = {
  category: "Sugerencia",
  description: "Añadir filtros por curso.",
  clientRequestId: "6ac99542-a52e-40d0-ab67-29a4b16db6db",
}

const request = (body: unknown) =>
  new Request("http://test/api/product-feedback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireProductFeedbackIdentity).mockResolvedValue(identity)
  vi.mocked(requireProductFeedbackRateLimit).mockResolvedValue(undefined)
})

describe("POST /api/product-feedback", () => {
  it("returns 401 when there is no authenticated session", async () => {
    vi.mocked(requireProductFeedbackIdentity).mockRejectedValue(
      new ApiErrorResponse("Unauthorized", 401),
    )
    expect((await POST(request(input))).status).toBe(401)
  })

  it("returns 400 for invalid or spoofed input before calling the service", async () => {
    const invalid = await POST(request({ ...input, personName: "Nombre falso" }))
    expect(invalid.status).toBe(400)
    expect(submitProductFeedback).not.toHaveBeenCalled()
  })

  it("returns 429 before persistence when the dedicated limit is exceeded", async () => {
    vi.mocked(requireProductFeedbackRateLimit).mockRejectedValue(
      new ApiErrorResponse("Too many feedback requests", 429),
    )
    expect((await POST(request(input))).status).toBe(429)
    expect(submitProductFeedback).not.toHaveBeenCalled()
  })

  it("returns 202 for locally accepted feedback that is pending Notion", async () => {
    vi.mocked(submitProductFeedback).mockResolvedValue({
      feedback: {
        id: "a2d626b1-f48c-4cff-87d3-ec6294f21cf3",
        createdAt: "2026-07-21T12:30:00.000Z",
        syncStatus: "pending",
      },
    })
    const response = await POST(request(input))
    expect(response.status).toBe(202)
    expect(submitProductFeedback).toHaveBeenCalledWith(
      { userId: identity.userId, personName: identity.personName },
      input,
    )
  })

  it("returns 201 when Notion is already synchronized", async () => {
    vi.mocked(submitProductFeedback).mockResolvedValue({
      feedback: {
        id: "a2d626b1-f48c-4cff-87d3-ec6294f21cf3",
        createdAt: "2026-07-21T12:30:00.000Z",
        syncStatus: "synced",
      },
    })
    expect((await POST(request(input))).status).toBe(201)
  })
})
