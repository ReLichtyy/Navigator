import { describe, it, expect, beforeEach, vi } from "vitest"

// Tagged-template sql mock: records query text + values, returns queued results.
const queries: { text: string; values: unknown[] }[] = []
let responses: unknown[][] = []
vi.mock("@/lib/db", () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => {
    queries.push({ text: strings.join("?"), values })
    return Promise.resolve(responses.shift() ?? [])
  },
}))

import { JobRepository } from "@/lib/server/repositories/job.repo"

beforeEach(() => {
  queries.length = 0
  responses = []
})

describe("JobRepository.enqueue — dedupe + kickIfPending", () => {
  it("kickIfPending on a pending dedupe-hit resets scheduled_at and returns the existing id (no INSERT)", async () => {
    responses = [[{ id: "j1", status: "pending" }], []]
    const id = await JobRepository.enqueue("ingest", { syllabusId: "s1" }, { kickIfPending: true })
    expect(id).toBe("j1")
    expect(queries).toHaveLength(2) // SELECT + UPDATE, no INSERT
    expect(queries[1].text).toContain("UPDATE jobs SET scheduled_at = now()")
    expect(queries[1].values).toContain("j1")
  })

  it("dedupe-hit without kickIfPending does not touch scheduled_at", async () => {
    responses = [[{ id: "j1", status: "pending" }]]
    const id = await JobRepository.enqueue("ingest", { syllabusId: "s1" })
    expect(id).toBe("j1")
    expect(queries).toHaveLength(1) // SELECT only
  })

  it("kickIfPending on a processing dedupe-hit does not reset the schedule", async () => {
    responses = [
      [
        {
          id: "j1",
          status: "processing",
          attempts: 3,
          max_attempts: 3,
          stale: false,
        },
      ],
    ]
    const id = await JobRepository.enqueue("ingest", { syllabusId: "s1" }, { kickIfPending: true })
    expect(id).toBe("j1")
    expect(queries).toHaveLength(1) // SELECT only, running job left alone
  })

  it("reactivates an exhausted processing job on an explicit user retry", async () => {
    responses = [
      [
        {
          id: "j1",
          status: "processing",
          attempts: 12,
          max_attempts: 3,
          stale: false,
        },
      ],
      [],
    ]

    const id = await JobRepository.enqueue("ingest", { syllabusId: "s1" }, { kickIfPending: true })

    expect(id).toBe("j1")
    expect(queries).toHaveLength(2)
    expect(queries[1].text).toContain("attempts = 0")
    expect(queries[1].text).toContain("status = 'pending'")
  })

  it("no dedupe-hit inserts a new job", async () => {
    responses = [[], [{ id: "j-new" }]]
    const id = await JobRepository.enqueue("ingest", { syllabusId: "s1" })
    expect(id).toBe("j-new")
    expect(queries[1].text).toContain("INSERT INTO jobs")
  })
})

describe("JobRepository.claimNext — optional filters", () => {
  it("passes the syllabusId filter into the claim query", async () => {
    responses = [[]]
    await JobRepository.claimNext("ingest", 10, { syllabusId: "s1" })
    expect(queries[0].values).toContain("s1")
    expect(queries[0].text).toContain("payload->>'syllabusId'")
  })

  it("passes the dedupeKey filter into the claim query", async () => {
    responses = [[]]
    await JobRepository.claimNext("study-bank", 10, { dedupeKey: "doc:s1:quiz:medio" })
    expect(queries[0].values).toContain("doc:s1:quiz:medio")
    expect(queries[0].text).toContain("payload->>'dedupeKey'")
  })

  it("binds null filters when none are given (global order)", async () => {
    responses = [[]]
    await JobRepository.claimNext("ingest")
    expect(queries[0].values).toContain(null)
  })

  it("never claims a job that already exhausted its attempts", async () => {
    responses = [[]]

    await JobRepository.claimNext("ingest")

    expect(queries[0].text).toContain("attempts < max_attempts")
  })
})
