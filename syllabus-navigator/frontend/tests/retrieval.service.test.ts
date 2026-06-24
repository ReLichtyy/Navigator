import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("@/lib/llm/embeddings", () => ({ embedText: vi.fn() }))
vi.mock("@/lib/server/repositories/chunk.repo", () => ({
  ChunkRepository: { search: vi.fn() },
}))

import { embedText } from "@/lib/llm/embeddings"
import { ChunkRepository } from "@/lib/server/repositories/chunk.repo"
import { RetrievalService } from "@/lib/server/services/retrieval.service"

const chunk = (id: string, distance: number, content = "x".repeat(10)) => ({
  id,
  chunk_index: 0,
  content,
  page_start: 1,
  page_end: 1,
  distance,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(embedText).mockResolvedValue([0.1, 0.2, 0.3])
})

describe("RetrievalService.retrieve — relevance gate", () => {
  it("no context when search returns nothing", async () => {
    vi.mocked(ChunkRepository.search).mockResolvedValue([])
    const r = await RetrievalService.retrieve("s1", "q")
    expect(r.hasContext).toBe(false)
    expect(r.citations).toEqual([])
  })

  it("no context when even the closest chunk is past the ceiling (off-topic)", async () => {
    vi.mocked(ChunkRepository.search).mockResolvedValue([chunk("a", 0.95), chunk("b", 1.2)] as any)
    const r = await RetrievalService.retrieve("s1", "q")
    expect(r.hasContext).toBe(false)
    expect(r.contextBlock).toBe("")
  })

  it("keeps relevant chunks and drops the noisy tail past the ceiling", async () => {
    vi.mocked(ChunkRepository.search).mockResolvedValue([
      chunk("a", 0.3),
      chunk("b", 0.5),
      chunk("c", 1.1), // dropped
    ] as any)
    const r = await RetrievalService.retrieve("s1", "q")
    expect(r.hasContext).toBe(true)
    expect(r.citations.map((c) => c.chunk_id)).toEqual(["a", "b"])
    expect(r.contextBlock).toContain("[Fragmento 1]")
    expect(r.contextBlock).toContain("[Fragmento 2]")
  })

  it("caps citations at 5 even when more chunks pass the gate", async () => {
    vi.mocked(ChunkRepository.search).mockResolvedValue(
      ["a", "b", "c", "d", "e", "f"].map((id) => chunk(id, 0.4)) as any,
    )
    const r = await RetrievalService.retrieve("s1", "q")
    expect(r.hasContext).toBe(true)
    expect(r.citations).toHaveLength(5)
  })
})
