import { describe, it, expect, beforeEach, vi } from "vitest"

// Capture the SQL text + interpolated values of each tagged-template call so we
// can assert the ownership scoping (a user must never retrieve foreign chunks).
const calls: { text: string; values: unknown[] }[] = []
vi.mock("@/lib/db", () => {
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join("?"), values })
    return Promise.resolve([])
  }
  sql.query = (text: string, params: unknown[]) => {
    calls.push({ text, values: params })
    return Promise.resolve([])
  }
  return { sql }
})

vi.mock("@/lib/llm/embeddings", () => ({
  toVectorLiteral: (v: number[]) => `[${v.join(",")}]`,
}))

import { ChunkRepository } from "@/lib/server/repositories/chunk.repo"

const EMB = [0.1, 0.2, 0.3]

beforeEach(() => {
  calls.length = 0
})

describe("ChunkRepository — retrieval is ownership-scoped", () => {
  it("searchByUser filters by su.user_id (cross-course retrieval)", async () => {
    await ChunkRepository.searchByUser("user-1", EMB, 5)
    expect(calls).toHaveLength(1)
    expect(calls[0].text).toContain("su.user_id =")
    expect(calls[0].values).toContain("user-1")
    expect(calls[0].values).toContain(5)
  })

  it("searchByCourse binds BOTH course_id and user_id (no foreign courses)", async () => {
    await ChunkRepository.searchByCourse("user-1", "course-9", EMB)
    expect(calls[0].text).toContain("su.course_id =")
    expect(calls[0].text).toContain("su.user_id =")
    expect(calls[0].values).toContain("user-1")
    expect(calls[0].values).toContain("course-9")
  })

  it("searchLexicalByCourse binds BOTH course_id and user_id", async () => {
    await ChunkRepository.searchLexicalByCourse("user-1", "course-9", "matrices", EMB)
    expect(calls[0].text).toContain("su.user_id =")
    expect(calls[0].values).toContain("user-1")
    expect(calls[0].values).toContain("course-9")
    expect(calls[0].values).toContain("matrices")
  })

  it("search scopes to the given syllabus id", async () => {
    await ChunkRepository.search("syl-1", EMB)
    expect(calls[0].text).toContain("c.syllabus_id =")
    expect(calls[0].values).toContain("syl-1")
  })

  it("course-wide study text is scoped by user_id too", async () => {
    await ChunkRepository.getConcatenatedTextByCourse("user-1", "course-9")
    expect(calls[0].text).toContain("su.user_id =")
    expect(calls[0].values).toContain("user-1")
  })

  it("document fingerprints include graph revisions, not only chunk timestamps", async () => {
    await ChunkRepository.contentFingerprint("syl-1")
    expect(calls[0].text).toContain("graph_generated_at")
    expect(calls[0].text).toContain("graph_status")
    expect(calls[0].text).toContain("syllabus_uploads")
  })

  it("course fingerprints include membership and the course-map revision", async () => {
    await ChunkRepository.contentFingerprintByCourse("user-1", "course-9")
    expect(calls[0].text).toContain("string_agg")
    expect(calls[0].text).toContain("course_graphs")
    expect(calls[0].text).toContain("updated_at")
    expect(calls[0].values).toContain("user-1")
    expect(calls[0].values).toContain("course-9")
  })
})
