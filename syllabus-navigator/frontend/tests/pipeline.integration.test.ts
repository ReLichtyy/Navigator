/**
 * pipeline.integration.test.ts — Sprint 3 #1: upload -> parse -> query.
 *
 * Threads the live service pipeline end to end with the I/O boundaries (PDF
 * parse, blob, OpenAI embeddings, SQL repos, graph/schedule LLM calls) replaced
 * by an in-memory store. Unlike the per-route unit tests, this exercises the
 * real data flow: DocumentService.processUpload (chunk text persisted) ->
 * IngestionService.runIngestJob (embeddings + graph) -> RetrievalService
 * (nearest-chunk search + relevance gate -> grounded citations).
 *
 * Embeddings are a deterministic bag-of-words over a small vocabulary so cosine
 * distance is meaningful: an on-topic question retrieves its chunk, an off-topic
 * one trips the relevance gate and returns no context.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"

// ── Deterministic toy embeddings ─────────────────────────────────────────────
const VOCAB = ["recursión", "recursion", "derivada", "derivative", "francia", "france", "pizza"]
function embed(text: string): number[] {
  const lower = text.toLowerCase()
  return VOCAB.map((w) => (lower.split(w).length - 1))
}
function cosineDistance(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 1 // orthogonal-by-default for empty vectors
  return 1 - dot / (Math.sqrt(na) * Math.sqrt(nb))
}

// ── In-memory store shared by the mocked repos ───────────────────────────────
const store = vi.hoisted(() => {
  interface Chunk {
    id: string
    syllabus_id: string
    chunk_index: number
    content: string
    page_start: number | null
    page_end: number | null
    embedding: number[] | null
  }
  return {
    uploads: new Map<string, any>(),
    chunks: [] as Chunk[],
    jobs: [] as { id: string; type: string; payload: any }[],
    graphs: new Map<string, any[]>(),
    seq: 0,
    reset() {
      this.uploads.clear()
      this.chunks.length = 0
      this.jobs.length = 0
      this.graphs.clear()
      this.seq = 0
    },
    id(prefix: string) {
      return `${prefix}-${++this.seq}`
    },
  }
})

vi.mock("@/lib/observability/logger", () => ({
  logInfo: vi.fn(), logWarn: vi.fn(), logError: vi.fn(),
}))

// auth-helpers pulls in next-auth; we only need ApiErrorResponse here.
vi.mock("@/lib/server/utils/auth-helpers", () => ({
  ApiErrorResponse: class extends Error {
    status: number
    constructor(message: string, status: number) { super(message); this.status = status }
  },
}))

vi.mock("@/lib/llm/embeddings", () => ({
  embedText: vi.fn(async (t: string) => embed(t)),
  embedTexts: vi.fn(async (ts: string[]) => ts.map(embed)),
  toVectorLiteral: (v: number[]) => `[${v.join(",")}]`,
}))

vi.mock("@/lib/server/rag/chunking", () => ({
  // Parse step: pretend the PDF yielded these two chunks of text.
  pdfToPageChunks: vi.fn(async () => [
    { text: "La recursión es una técnica donde una función se llama a sí misma.", pageStart: 1, pageEnd: 1 },
    { text: "La derivada mide la tasa de cambio instantánea de una función.", pageStart: 2, pageEnd: 2 },
  ]),
}))

vi.mock("@/lib/server/storage/blob", () => ({
  storePdf: vi.fn(async () => "blob://stored.pdf"),
}))

vi.mock("@/lib/server/rag/graph-gen", () => ({
  extractGraphFromText: vi.fn(async () => [
    { title: "Recursión", prerequisites: [] },
    { title: "Derivadas", prerequisites: ["Recursión"] },
  ]),
}))

vi.mock("@/lib/server/rag/schedule-gen", () => ({
  extractScheduleFromText: vi.fn(async () => []),
}))

vi.mock("@/lib/server/repositories/document.repo", () => ({
  DocumentRepository: {
    createUpload: vi.fn(async (userId: string, filename: string, _hash: string, opts: any) => {
      const id = store.id("up")
      const row = {
        id, user_id: userId, original_filename: filename,
        status: "pending", graph_status: "pending",
        file_url: opts?.fileUrl ?? null, expires_at: opts?.expiresAt ?? null,
      }
      store.uploads.set(id, row)
      return { id, original_filename: filename }
    }),
    setStatus: vi.fn(async (id: string, status: string, err?: string) => {
      const u = store.uploads.get(id); if (u) { u.status = status; u.error_message = err ?? null }
    }),
    setGraphStatus: vi.fn(async (id: string, status: string, err?: string) => {
      const u = store.uploads.get(id); if (u) { u.graph_status = status; u.graph_error = err ?? null }
    }),
  },
}))

vi.mock("@/lib/server/repositories/chunk.repo", () => ({
  ChunkRepository: {
    replaceChunksText: vi.fn(async (syllabusId: string, chunks: any[]) => {
      store.chunks = store.chunks.filter((c) => c.syllabus_id !== syllabusId)
      chunks.forEach((c, i) => store.chunks.push({
        id: store.id("ch"), syllabus_id: syllabusId, chunk_index: i,
        content: c.text, page_start: c.pageStart, page_end: c.pageEnd, embedding: null,
      }))
      return chunks.length
    }),
    listPendingEmbeddings: vi.fn(async (syllabusId: string) =>
      store.chunks.filter((c) => c.syllabus_id === syllabusId && c.embedding === null)
        .sort((a, b) => a.chunk_index - b.chunk_index)
        .map((c) => ({ id: c.id, content: c.content }))),
    setEmbedding: vi.fn(async (chunkId: string, embedding: number[]) => {
      const c = store.chunks.find((x) => x.id === chunkId); if (c) c.embedding = embedding
    }),
    getConcatenatedText: vi.fn(async (syllabusId: string) =>
      store.chunks.filter((c) => c.syllabus_id === syllabusId)
        .sort((a, b) => a.chunk_index - b.chunk_index).map((c) => c.content).join("\n\n")),
    search: vi.fn(async (syllabusId: string, q: number[], limit = 8) =>
      store.chunks
        .filter((c) => c.syllabus_id === syllabusId && c.embedding !== null)
        .map((c) => ({
          id: c.id, chunk_index: c.chunk_index, content: c.content,
          page_start: c.page_start, page_end: c.page_end,
          distance: cosineDistance(q, c.embedding as number[]),
        }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, limit)),
  },
}))

vi.mock("@/lib/server/repositories/job.repo", () => ({
  JobRepository: {
    enqueue: vi.fn(async (type: string, payload: any) => {
      const id = store.id("job"); store.jobs.push({ id, type, payload }); return id
    }),
  },
}))

vi.mock("@/lib/server/repositories/graph.repo", () => ({
  GraphRepository: {
    replaceGraph: vi.fn(async (syllabusId: string, nodes: any[]) => { store.graphs.set(syllabusId, nodes) }),
  },
}))

vi.mock("@/lib/server/repositories/schedule.repo", () => ({
  ScheduleRepository: {
    replaceEvents: vi.fn(async (_id: string, events: any[]) => events.length),
  },
}))

import { DocumentService } from "@/lib/server/services/document.service"
import { IngestionService } from "@/lib/server/services/ingestion.service"
import { RetrievalService } from "@/lib/server/services/retrieval.service"

// A minimal File whose bytes start with the %PDF- magic so processUpload accepts it.
function pdfFile(): File {
  const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])
  return new File([bytes], "calc.pdf", { type: "application/pdf" })
}

beforeEach(() => { vi.clearAllMocks(); store.reset() })

describe("upload -> parse -> query pipeline", () => {
  it("persists parsed chunks and enqueues an ingest job on upload", async () => {
    const res = await DocumentService.processUpload("user-1", "free", pdfFile())

    expect(res.id).toMatch(/^up-/)
    expect(res.jobId).toMatch(/^job-/)
    // Parse step ran: two chunks persisted (text only, no embedding yet).
    expect(store.chunks).toHaveLength(2)
    expect(store.chunks.every((c) => c.embedding === null)).toBe(true)
    // Account upload stored the PDF and is non-ephemeral.
    expect(store.uploads.get(res.id).file_url).toBe("blob://stored.pdf")
    expect(store.uploads.get(res.id).expires_at).toBeNull()
    expect(store.jobs[0]).toMatchObject({ type: "ingest", payload: { syllabusId: res.id } })
  })

  it("worker embeds chunks, marks processed, and builds the graph", async () => {
    const { id } = await DocumentService.processUpload("user-1", "free", pdfFile())
    const out = await IngestionService.runIngestJob(id)

    expect(out.embedded).toBe(2)
    expect(out.topics).toBe(2)
    expect(store.chunks.every((c) => c.embedding !== null)).toBe(true)
    expect(store.uploads.get(id).status).toBe("processed")
    expect(store.uploads.get(id).graph_status).toBe("ready")
    expect(store.graphs.get(id)).toHaveLength(2)
  })

  it("retrieves grounded context + citations for an on-topic question", async () => {
    const { id } = await DocumentService.processUpload("user-1", "free", pdfFile())
    await IngestionService.runIngestJob(id)

    const r = await RetrievalService.retrieve(id, "¿Qué es la recursión?")

    expect(r.hasContext).toBe(true)
    expect(r.citations.length).toBeGreaterThan(0)
    // The closest chunk is the recursion one, not the derivative one.
    expect(r.citations[0].quote).toContain("recursión")
    expect(r.contextBlock).toContain("recursión")
  })

  it("returns no context for an off-topic question (relevance gate)", async () => {
    const { id } = await DocumentService.processUpload("user-1", "free", pdfFile())
    await IngestionService.runIngestJob(id)

    const r = await RetrievalService.retrieve(id, "What is the capital of France?")

    expect(r.hasContext).toBe(false)
    expect(r.citations).toHaveLength(0)
    expect(r.contextBlock).toBe("")
  })

  it("guest uploads are ephemeral and do not store the raw PDF", async () => {
    const { id } = await DocumentService.processUpload("guest-1", "guest", pdfFile())
    const u = store.uploads.get(id)
    expect(u.file_url).toBeNull()
    expect(u.expires_at).not.toBeNull()
  })
})
