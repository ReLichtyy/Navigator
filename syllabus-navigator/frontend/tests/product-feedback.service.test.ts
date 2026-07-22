import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  submitProductFeedback,
  type ProductFeedbackServiceDependencies,
} from "@/lib/server/services/product-feedback.service"

const record = {
  id: "a2d626b1-f48c-4cff-87d3-ec6294f21cf3",
  userId: "b7cb2c79-8f64-44d4-a1d1-af669d8099f8",
  personName: "Ada Lovelace",
  category: "Sugerencia" as const,
  description: "Añadir filtros por curso.",
  clientRequestId: "6ac99542-a52e-40d0-ab67-29a4b16db6db",
  notionPageId: null,
  syncStatus: "pending" as const,
  createdAt: "2026-07-21T12:30:00.000Z",
}

const input = {
  category: record.category,
  description: record.description,
  clientRequestId: record.clientRequestId,
}

function makeDeps(): ProductFeedbackServiceDependencies {
  return {
    repository: {
      createOrGet: vi.fn().mockResolvedValue({ record, created: true }),
      claimForSync: vi.fn().mockResolvedValue(record),
      markSynced: vi.fn().mockImplementation(async (_id, pageId) => ({
        ...record,
        notionPageId: pageId,
        syncStatus: "synced" as const,
      })),
      markPending: vi.fn().mockResolvedValue(undefined),
    },
    syncFeedback: vi.fn().mockResolvedValue({ status: "pending", reason: "not_configured" }),
    enqueueSync: vi.fn().mockResolvedValue(undefined),
  }
}

beforeEach(() => vi.clearAllMocks())

describe("submitProductFeedback", () => {
  it("persists locally before attempting the external sync", async () => {
    const deps = makeDeps()
    vi.mocked(deps.syncFeedback).mockResolvedValue({ status: "synced", pageId: "notion-page" })

    const result = await submitProductFeedback(
      { userId: record.userId, personName: record.personName },
      input,
      deps,
    )

    expect(deps.repository.createOrGet).toHaveBeenCalledWith({
      userId: record.userId,
      personName: record.personName,
      ...input,
    })
    expect(vi.mocked(deps.repository.createOrGet).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(deps.syncFeedback).mock.invocationCallOrder[0],
    )
    expect(deps.repository.claimForSync).toHaveBeenCalledWith(record.id)
    expect(vi.mocked(deps.repository.claimForSync).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(deps.syncFeedback).mock.invocationCallOrder[0],
    )
    expect(deps.repository.markSynced).toHaveBeenCalledWith(record.id, "notion-page")
    expect(result.feedback.syncStatus).toBe("synced")
  })

  it("returns pending without enqueueing when variables are not configured", async () => {
    const deps = makeDeps()
    const result = await submitProductFeedback(
      { userId: record.userId, personName: record.personName },
      input,
      deps,
    )

    expect(result.feedback).toEqual({
      id: record.id,
      createdAt: record.createdAt,
      syncStatus: "pending",
    })
    expect(deps.repository.markPending).toHaveBeenCalledWith(record.id, "not_configured")
    expect(deps.enqueueSync).not.toHaveBeenCalled()
  })

  it("keeps transient failures pending and relies on the atomic job for a new row", async () => {
    const deps = makeDeps()
    vi.mocked(deps.syncFeedback).mockResolvedValue({
      status: "pending",
      reason: "rate_limited",
      retryable: true,
    })

    const result = await submitProductFeedback(
      { userId: record.userId, personName: record.personName },
      input,
      deps,
    )

    expect(deps.repository.markPending).toHaveBeenCalledWith(record.id, "rate_limited")
    expect(deps.enqueueSync).not.toHaveBeenCalled()
    expect(result.feedback.syncStatus).toBe("pending")
  })

  it("still acknowledges locally persisted feedback when the auxiliary enqueue fails", async () => {
    const deps = makeDeps()
    vi.mocked(deps.repository.createOrGet).mockResolvedValue({ record, created: false })
    vi.mocked(deps.syncFeedback).mockResolvedValue({
      status: "pending",
      reason: "rate_limited",
      retryable: true,
    })
    vi.mocked(deps.enqueueSync).mockRejectedValue(new Error("queue unavailable"))

    await expect(
      submitProductFeedback({ userId: record.userId, personName: record.personName }, input, deps),
    ).resolves.toMatchObject({ feedback: { id: record.id, syncStatus: "pending" } })
  })

  it("keeps configuration failures pending so the existing job can recover later", async () => {
    const deps = makeDeps()
    vi.mocked(deps.syncFeedback).mockResolvedValue({
      status: "pending",
      reason: "unauthorized",
      retryable: false,
    })

    const result = await submitProductFeedback(
      { userId: record.userId, personName: record.personName },
      input,
      deps,
    )

    expect(deps.repository.markPending).toHaveBeenCalledWith(record.id, "unauthorized")
    expect(result.feedback.syncStatus).toBe("pending")
  })

  it("does not resync an idempotent request that is already synced", async () => {
    const deps = makeDeps()
    vi.mocked(deps.repository.createOrGet).mockResolvedValue({
      created: false,
      record: { ...record, syncStatus: "synced", notionPageId: "existing-page" },
    })

    const result = await submitProductFeedback(
      { userId: record.userId, personName: record.personName },
      input,
      deps,
    )

    expect(deps.syncFeedback).not.toHaveBeenCalled()
    expect(result.feedback.syncStatus).toBe("synced")
  })

  it("allows only one concurrent replay to enter the external sync", async () => {
    const deps = makeDeps()
    let leaseAvailable = true
    vi.mocked(deps.repository.claimForSync).mockImplementation(async () => {
      if (!leaseAvailable) return null
      leaseAvailable = false
      return record
    })
    vi.mocked(deps.syncFeedback).mockResolvedValue({ status: "synced", pageId: "notion-page" })

    const results = await Promise.all([
      submitProductFeedback({ userId: record.userId, personName: record.personName }, input, deps),
      submitProductFeedback({ userId: record.userId, personName: record.personName }, input, deps),
    ])

    expect(deps.syncFeedback).toHaveBeenCalledTimes(1)
    expect(results.map((result) => result.feedback.syncStatus).sort()).toEqual([
      "pending",
      "synced",
    ])
  })
})
