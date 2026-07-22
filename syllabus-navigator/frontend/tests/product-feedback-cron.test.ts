import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/server/services/ingestion.service", () => ({
  IngestionService: { drainQueue: vi.fn().mockResolvedValue({ processed: 0, failed: 0 }) },
}))
vi.mock("@/lib/server/services/study-bank.service", () => ({
  StudyBankService: { drain: vi.fn().mockResolvedValue({ processed: 0, failed: 0 }) },
}))
vi.mock("@/lib/server/services/product-feedback.service", () => ({
  drainProductFeedbackSyncQueue: vi.fn().mockResolvedValue({
    processed: 0,
    failed: 0,
    retried: 0,
    deferred: true,
  }),
}))
vi.mock("@/lib/observability/logger", () => ({ logError: vi.fn(), logInfo: vi.fn() }))

import { drainProductFeedbackSyncQueue } from "@/lib/server/services/product-feedback.service"
import { POST } from "../app/api/cron/process/route"

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = "cron-secret"
})

describe("cron product feedback integration", () => {
  it("drains the isolated projection queue from the authenticated cron", async () => {
    const response = await POST(
      new Request("http://test/api/cron/process", {
        method: "POST",
        headers: { authorization: "Bearer cron-secret" },
      }),
    )

    expect(response.status).toBe(200)
    expect(drainProductFeedbackSyncQueue).toHaveBeenCalledWith(1)
    expect((await response.json()).productFeedback).toEqual({
      processed: 0,
      failed: 0,
      retried: 0,
      deferred: true,
    })
  })
})
