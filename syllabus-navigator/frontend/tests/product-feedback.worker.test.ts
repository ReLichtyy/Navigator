import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  drainProductFeedbackSyncQueue,
  type ProductFeedbackQueueDependencies,
} from "@/lib/server/services/product-feedback.service"

const record = {
  id: "a2d626b1-f48c-4cff-87d3-ec6294f21cf3",
  userId: "b7cb2c79-8f64-44d4-a1d1-af669d8099f8",
  personName: "Ada Lovelace",
  category: "Sugerencia" as const,
  description: "Anadir filtros por curso.",
  clientRequestId: "6ac99542-a52e-40d0-ab67-29a4b16db6db",
  notionPageId: null,
  syncStatus: "pending" as const,
  createdAt: "2026-07-21T12:30:00.000Z",
}

const job = {
  id: "6ee95661-7f50-4dd4-ac6c-b927bd3a8a16",
  type: "product-feedback-sync",
  payload: { feedbackId: record.id, dedupeKey: record.id },
  status: "processing",
  attempts: 1,
  max_attempts: 8,
  result: null,
  error: null,
}

function makeDeps(): ProductFeedbackQueueDependencies {
  return {
    isConfigured: vi.fn().mockReturnValue(true),
    hasPendingSyncJob: vi.fn().mockResolvedValue(true),
    checkReadiness: vi.fn().mockResolvedValue({ ready: true }),
    repository: {
      findById: vi.fn().mockResolvedValue(record),
      claimForSync: vi.fn().mockResolvedValue(record),
      markSynced: vi.fn().mockResolvedValue({
        ...record,
        notionPageId: "notion-page",
        syncStatus: "synced" as const,
      }),
      markPending: vi.fn().mockResolvedValue(undefined),
      markFailed: vi.fn().mockResolvedValue(undefined),
    },
    claimNext: vi.fn().mockResolvedValueOnce(job).mockResolvedValue(null),
    completeJob: vi.fn().mockResolvedValue(undefined),
    failJob: vi.fn().mockResolvedValue({ retried: true }),
    syncFeedback: vi.fn().mockResolvedValue({ status: "synced", pageId: "notion-page" }),
  }
}

beforeEach(() => vi.clearAllMocks())

describe("drainProductFeedbackSyncQueue", () => {
  it("does not claim or consume attempts while Notion variables are absent", async () => {
    const deps = makeDeps()
    vi.mocked(deps.isConfigured).mockReturnValue(false)

    const result = await drainProductFeedbackSyncQueue(3, deps)

    expect(result).toEqual({
      processed: 0,
      failed: 0,
      retried: 0,
      deferred: true,
      deferredReason: "not_configured",
    })
    expect(deps.hasPendingSyncJob).not.toHaveBeenCalled()
    expect(deps.checkReadiness).not.toHaveBeenCalled()
    expect(deps.claimNext).not.toHaveBeenCalled()
  })

  it("does not call Notion readiness when there are no feedback jobs", async () => {
    const deps = makeDeps()
    vi.mocked(deps.hasPendingSyncJob).mockResolvedValue(false)

    const result = await drainProductFeedbackSyncQueue(3, deps)

    expect(result).toEqual({ processed: 0, failed: 0, retried: 0, deferred: false })
    expect(deps.checkReadiness).not.toHaveBeenCalled()
    expect(deps.claimNext).not.toHaveBeenCalled()
  })

  it("defers without claiming a job when the Notion schema or access is not ready", async () => {
    const deps = makeDeps()
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    vi.mocked(deps.checkReadiness).mockResolvedValue({
      ready: false,
      reason: "schema_mismatch",
    })

    const result = await drainProductFeedbackSyncQueue(3, deps)

    expect(result).toEqual({
      processed: 0,
      failed: 0,
      retried: 0,
      deferred: true,
      deferredReason: "schema_mismatch",
    })
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('"reason":"schema_mismatch"'))
    expect(deps.claimNext).not.toHaveBeenCalled()
  })

  it("syncs a claimed local row and completes the job", async () => {
    const deps = makeDeps()

    const result = await drainProductFeedbackSyncQueue(3, deps)

    expect(deps.repository.findById).toHaveBeenCalledWith(record.id)
    expect(deps.repository.claimForSync).toHaveBeenCalledWith(record.id)
    expect(deps.repository.markSynced).toHaveBeenCalledWith(record.id, "notion-page")
    expect(deps.completeJob).toHaveBeenCalledWith(job.id, {
      feedbackId: record.id,
      notionPageId: "notion-page",
    })
    expect(result).toEqual({ processed: 1, failed: 0, retried: 0, deferred: false })
  })

  it("requeues the job without calling Notion while another request owns the sync lease", async () => {
    const deps = makeDeps()
    vi.mocked(deps.repository.claimForSync).mockResolvedValue(null)

    const result = await drainProductFeedbackSyncQueue(1, deps)

    expect(deps.syncFeedback).not.toHaveBeenCalled()
    expect(deps.failJob).toHaveBeenCalledWith(job.id, "feedback_sync_in_progress", false)
    expect(result).toEqual({ processed: 0, failed: 0, retried: 1, deferred: false })
  })

  it("fails a malformed internal UUID payload before issuing a repository query", async () => {
    const deps = makeDeps()
    vi.mocked(deps.claimNext).mockReset()
    vi.mocked(deps.claimNext)
      .mockResolvedValueOnce({
        ...job,
        payload: { feedbackId: "not-a-uuid", dedupeKey: "not-a-uuid" },
      })
      .mockResolvedValue(null)

    const result = await drainProductFeedbackSyncQueue(1, deps)

    expect(deps.repository.findById).not.toHaveBeenCalled()
    expect(deps.failJob).toHaveBeenCalledWith(job.id, "invalid_feedback_job_payload", true)
    expect(result).toEqual({ processed: 0, failed: 1, retried: 0, deferred: false })
  })

  it("requeues a retryable external failure without exposing feedback content", async () => {
    const deps = makeDeps()
    vi.mocked(deps.syncFeedback).mockResolvedValue({
      status: "pending",
      reason: "rate_limited",
      retryable: true,
    })

    const result = await drainProductFeedbackSyncQueue(1, deps)

    expect(deps.repository.markPending).toHaveBeenCalledWith(record.id, "rate_limited")
    expect(deps.failJob).toHaveBeenCalledWith(job.id, "rate_limited", false)
    expect(result).toEqual({ processed: 0, failed: 0, retried: 1, deferred: false })
  })

  it("marks the local projection failed when a retryable job exhausts its attempts", async () => {
    const deps = makeDeps()
    vi.mocked(deps.syncFeedback).mockResolvedValue({
      status: "pending",
      reason: "rate_limited",
      retryable: true,
    })
    vi.mocked(deps.failJob).mockResolvedValue({ retried: false })

    const result = await drainProductFeedbackSyncQueue(1, deps)

    expect(deps.repository.markFailed).toHaveBeenCalledWith(record.id, "rate_limited")
    expect(result).toEqual({ processed: 0, failed: 1, retried: 0, deferred: false })
  })

  it("fails a non-retryable projection error permanently", async () => {
    const deps = makeDeps()
    vi.mocked(deps.syncFeedback).mockResolvedValue({
      status: "pending",
      reason: "unauthorized",
      retryable: false,
    })
    vi.mocked(deps.failJob).mockResolvedValue({ retried: false })

    const result = await drainProductFeedbackSyncQueue(1, deps)

    expect(deps.repository.markFailed).toHaveBeenCalledWith(record.id, "unauthorized")
    expect(deps.failJob).toHaveBeenCalledWith(job.id, "unauthorized", true)
    expect(result).toEqual({ processed: 0, failed: 1, retried: 0, deferred: false })
  })
})
