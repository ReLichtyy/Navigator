import { beforeEach, describe, expect, it, vi } from "vitest"

const queries: { text: string; values: unknown[] }[] = []
let responses: unknown[][] = []

vi.mock("@/lib/db", () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => {
    queries.push({ text: strings.join("?"), values })
    return Promise.resolve(responses.shift() ?? [])
  },
}))

import { ProductFeedbackRepository } from "@/lib/server/repositories/product-feedback.repo"

const row = {
  id: "a2d626b1-f48c-4cff-87d3-ec6294f21cf3",
  user_id: "b7cb2c79-8f64-44d4-a1d1-af669d8099f8",
  person_name: "Ada Lovelace",
  category: "Sugerencia",
  description: "Anadir filtros por curso.",
  client_request_id: "6ac99542-a52e-40d0-ab67-29a4b16db6db",
  notion_page_id: null,
  notion_sync_status: "pending",
  created_at: "2026-07-21T12:30:00.000Z",
  created: true,
}

beforeEach(() => {
  queries.length = 0
  responses = []
})

describe("ProductFeedbackRepository", () => {
  it("persists the feedback and its delayed retry job atomically without PII in the job payload", async () => {
    responses = [[row]]

    const result = await ProductFeedbackRepository.createOrGet({
      userId: row.user_id,
      personName: row.person_name,
      category: "Sugerencia",
      description: row.description,
      clientRequestId: row.client_request_id,
    })

    expect(result.created).toBe(true)
    expect(queries).toHaveLength(1)
    expect(queries[0].text).toContain("WITH inserted_feedback AS")
    expect(queries[0].text).toContain("INSERT INTO jobs")
    expect(queries[0].text).toContain("jsonb_build_object('feedbackId'")
    expect(queries[0].text).toContain("'dedupeKey'")
    expect(queries[0].text).toContain("interval '2 minutes'")

    const jobSql = queries[0].text.slice(queries[0].text.indexOf("INSERT INTO jobs"))
    expect(jobSql).not.toContain("person_name")
    expect(jobSql).not.toContain("description")
  })

  it("marks the projection synced and settles any still-pending retry job in one query", async () => {
    responses = [[{ ...row, notion_page_id: "notion-page", notion_sync_status: "synced" }]]

    const synced = await ProductFeedbackRepository.markSynced(row.id, "notion-page")

    expect(synced?.syncStatus).toBe("synced")
    expect(queries).toHaveLength(1)
    expect(queries[0].text).toContain("UPDATE product_feedback")
    expect(queries[0].text).toContain("UPDATE jobs")
    expect(queries[0].text).toContain("status = 'completed'")
    expect(queries[0].text).toContain("payload->>'dedupeKey'")
  })

  it("claims one external-sync lease atomically with stale recovery", async () => {
    responses = [[row]]

    const claimed = await ProductFeedbackRepository.claimForSync(row.id)

    expect(claimed?.id).toBe(row.id)
    expect(queries).toHaveLength(1)
    expect(queries[0].text).toContain("sync_started_at = now()")
    expect(queries[0].text).toContain("sync_started_at IS NULL")
    expect(queries[0].text).toContain("interval '15 minutes'")
    expect(queries[0].text).toContain("RETURNING id")
  })

  it("checks for queued feedback work without reading its PII payload", async () => {
    responses = [[{ pending: 1 }]]

    await expect(ProductFeedbackRepository.hasPendingSyncJob()).resolves.toBe(true)

    expect(queries).toHaveLength(1)
    expect(queries[0].text).toContain("FROM jobs")
    expect(queries[0].text).toContain("status IN ('pending', 'processing')")
    expect(queries[0].text).not.toContain("person_name")
    expect(queries[0].text).not.toContain("description")
  })

  it("re-reads an idempotent row hidden by a concurrent insert snapshot", async () => {
    responses = [[], [{ ...row, created: false }]]

    const result = await ProductFeedbackRepository.createOrGet({
      userId: row.user_id,
      personName: row.person_name,
      category: "Sugerencia",
      description: row.description,
      clientRequestId: row.client_request_id,
    })

    expect(result).toEqual({
      record: expect.objectContaining({ id: row.id, clientRequestId: row.client_request_id }),
      created: false,
    })
    expect(queries).toHaveLength(2)
    expect(queries[1].text).toContain("WHERE user_id =")
    expect(queries[1].text).toContain("client_request_id =")
  })

  it("settles the delayed job when the external error is permanent", async () => {
    responses = [[]]

    await ProductFeedbackRepository.markFailed(row.id, "unauthorized")

    expect(queries).toHaveLength(1)
    expect(queries[0].text).toContain("notion_sync_status = 'failed'")
    expect(queries[0].text).toContain("UPDATE jobs")
    expect(queries[0].text).toContain("status = 'failed'")
    expect(queries[0].text).toContain("payload->>'dedupeKey'")
  })
})
