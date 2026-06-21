import { describe, it, expect, beforeEach, vi } from "vitest"

// --- module mocks (no DB, no real auth) ---
vi.mock("@/lib/auth/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn() }))
vi.mock("@/lib/observability/logger", () => ({ logError: vi.fn(), logInfo: vi.fn() }))
vi.mock("@/lib/server/repositories/document.repo", () => ({
  DocumentRepository: { findByIdAndUser: vi.fn(), setGraphStatus: vi.fn() },
}))
vi.mock("@/lib/server/repositories/graph.repo", () => ({
  GraphRepository: { getGraph: vi.fn() },
}))
vi.mock("@/lib/server/repositories/job.repo", () => ({
  JobRepository: { enqueue: vi.fn() },
}))
vi.mock("@/lib/server/services/worker-trigger", () => ({ triggerIngestionWorker: vi.fn() }))

import { auth } from "@/lib/auth/auth"
import { DocumentRepository } from "@/lib/server/repositories/document.repo"
import { GraphRepository } from "@/lib/server/repositories/graph.repo"
import { JobRepository } from "@/lib/server/repositories/job.repo"
import { triggerIngestionWorker } from "@/lib/server/services/worker-trigger"
import { GET } from "../app/api/graph/[syllabusId]/route"
import { POST } from "../app/api/graph/[syllabusId]/reprocess/route"

const params = (syllabusId: string) => ({ params: Promise.resolve({ syllabusId }) })
const asUser = (id = "u1") => vi.mocked(auth).mockResolvedValue({ user: { id, role: "free" } } as any)
const anon = () => vi.mocked(auth).mockResolvedValue(null as any)

const DOC = { id: "s1", user_id: "u1", graph_status: "ready", graph_error: null }
const GRAPH = {
  topics: [{ id: "t1", label: "Intro", weight_percent: 10 }],
  edges: [{ prerequisite_topic_id: "t1", target_topic_id: "t2" }],
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("GET /api/graph/[syllabusId]", () => {
  it("401 when unauthenticated", async () => {
    anon()
    const res = await GET(new Request("http://t/api/graph/s1"), params("s1"))
    expect(res.status).toBe(401)
  })

  it("404 when syllabus not owned by user", async () => {
    asUser()
    vi.mocked(DocumentRepository.findByIdAndUser).mockResolvedValue(undefined)
    const res = await GET(new Request("http://t/api/graph/s1"), params("s1"))
    expect(res.status).toBe(404)
    // ownership scoped by (id, userId)
    expect(DocumentRepository.findByIdAndUser).toHaveBeenCalledWith("s1", "u1")
  })

  it("200 returns nodes/edges shaped for the UI", async () => {
    asUser()
    vi.mocked(DocumentRepository.findByIdAndUser).mockResolvedValue(DOC as any)
    vi.mocked(GraphRepository.getGraph).mockResolvedValue(GRAPH as any)
    const res = await GET(new Request("http://t/api/graph/s1"), params("s1"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      syllabus_id: "s1",
      graph_status: "ready",
      nodes: [{ id: "t1", label: "Intro", weight_percent: 10 }],
      edges: [{ source: "t1", target: "t2" }],
    })
  })
})

describe("POST /api/graph/[syllabusId]/reprocess", () => {
  it("401 when unauthenticated", async () => {
    anon()
    const res = await POST(new Request("http://t/x", { method: "POST" }), params("s1"))
    expect(res.status).toBe(401)
  })

  it("404 when not owned", async () => {
    asUser()
    vi.mocked(DocumentRepository.findByIdAndUser).mockResolvedValue(undefined)
    const res = await POST(new Request("http://t/x", { method: "POST" }), params("s1"))
    expect(res.status).toBe(404)
    expect(JobRepository.enqueue).not.toHaveBeenCalled()
  })

  it("200 re-enqueues, marks pending, kicks worker", async () => {
    asUser()
    vi.mocked(DocumentRepository.findByIdAndUser).mockResolvedValue({ ...DOC, graph_status: "pending" } as any)
    vi.mocked(GraphRepository.getGraph).mockResolvedValue(GRAPH as any)
    const res = await POST(new Request("http://t/x", { method: "POST" }), params("s1"))
    expect(res.status).toBe(200)
    expect(DocumentRepository.setGraphStatus).toHaveBeenCalledWith("s1", "pending", null)
    expect(JobRepository.enqueue).toHaveBeenCalledWith("ingest", { syllabusId: "s1" })
    expect(triggerIngestionWorker).toHaveBeenCalled()
  })
})
