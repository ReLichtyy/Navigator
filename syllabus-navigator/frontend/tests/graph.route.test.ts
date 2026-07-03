import { describe, it, expect, beforeEach, vi } from "vitest"

// --- module mocks (no DB, no real auth) ---
vi.mock("@/lib/server/utils/auth-helpers", () => {
  class ApiErrorResponse extends Error {
    status: number
    constructor(message: string, status: number) {
      super(message)
      this.status = status
      this.name = "ApiErrorResponse"
    }
  }
  return {
    requireAuth: vi.fn(),
    getAuthedUser: vi.fn(),
    requireRateLimit: vi.fn(),
    ApiErrorResponse,
  }
})
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn() }))
vi.mock("@/lib/observability/logger", () => ({ logError: vi.fn(), logInfo: vi.fn() }))
vi.mock("@/lib/server/repositories/document.repo", () => ({
  DocumentRepository: { findByIdAndUser: vi.fn(), setGraphStatus: vi.fn() },
}))
vi.mock("@/lib/server/repositories/graph.repo", () => ({
  GraphRepository: { getGraph: vi.fn(), replaceGraph: vi.fn() },
}))
vi.mock("@/lib/server/repositories/job.repo", () => ({
  JobRepository: { enqueue: vi.fn() },
}))
vi.mock("@/lib/server/services/worker-trigger", () => ({ triggerIngestionWorker: vi.fn() }))
vi.mock("@/lib/server/services/ingestion.service", () => ({
  IngestionService: { drainForSyllabus: vi.fn() },
}))

import { requireAuth, getAuthedUser, ApiErrorResponse } from "@/lib/server/utils/auth-helpers"
import { DocumentRepository } from "@/lib/server/repositories/document.repo"
import { GraphRepository } from "@/lib/server/repositories/graph.repo"
import { JobRepository } from "@/lib/server/repositories/job.repo"
import { IngestionService } from "@/lib/server/services/ingestion.service"
import { GET, PATCH } from "../app/api/graph/[syllabusId]/route"
import { POST } from "../app/api/graph/[syllabusId]/reprocess/route"

const patchReq = (body: unknown) =>
  new Request("http://t/api/graph/s1", { method: "PATCH", body: JSON.stringify(body) })

const params = (syllabusId: string) => ({ params: Promise.resolve({ syllabusId }) })
const asUser = (id = "u1", role = "free") => (
  vi.mocked(requireAuth).mockResolvedValue({ userId: id, role } as any),
  vi.mocked(getAuthedUser).mockResolvedValue({ userId: id, role } as any)
)
const anon = () => (
  vi.mocked(requireAuth).mockRejectedValue(new ApiErrorResponse("Unauthorized", 401)),
  vi.mocked(getAuthedUser).mockResolvedValue(null as any)
)

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

  it("200 re-enqueues with backoff kick and drains only this syllabus", async () => {
    asUser()
    vi.mocked(DocumentRepository.findByIdAndUser).mockResolvedValue({
      ...DOC,
      graph_status: "pending",
    } as any)
    vi.mocked(GraphRepository.getGraph).mockResolvedValue(GRAPH as any)
    const res = await POST(new Request("http://t/x", { method: "POST" }), params("s1"))
    expect(res.status).toBe(200)
    expect(DocumentRepository.setGraphStatus).toHaveBeenCalledWith("s1", "pending", null)
    // User-initiated retry skips the backoff window on a dedupe-hit.
    expect(JobRepository.enqueue).toHaveBeenCalledWith(
      "ingest",
      { syllabusId: "s1" },
      { kickIfPending: true },
    )
    // Targeted drain: the clicked doc's job, not the first 5 of the global queue.
    expect(IngestionService.drainForSyllabus).toHaveBeenCalledWith("s1")
  })
})

describe("PATCH /api/graph/[syllabusId] (editable mind map)", () => {
  it("401 when unauthenticated", async () => {
    anon()
    const res = await PATCH(patchReq({ nodes: [], edges: [] }), params("s1"))
    expect(res.status).toBe(401)
  })

  it("404 when not owned", async () => {
    asUser()
    vi.mocked(DocumentRepository.findByIdAndUser).mockResolvedValue(undefined)
    const res = await PATCH(patchReq({ nodes: [{ id: "a", label: "A" }], edges: [] }), params("s1"))
    expect(res.status).toBe(404)
    expect(GraphRepository.replaceGraph).not.toHaveBeenCalled()
  })

  it("400 on invalid body (missing label)", async () => {
    asUser()
    vi.mocked(DocumentRepository.findByIdAndUser).mockResolvedValue(DOC as any)
    const res = await PATCH(patchReq({ nodes: [{ id: "a" }], edges: [] }), params("s1"))
    expect(res.status).toBe(400)
  })

  it("400 when the edited graph has a cycle", async () => {
    asUser()
    vi.mocked(DocumentRepository.findByIdAndUser).mockResolvedValue(DOC as any)
    const res = await PATCH(
      patchReq({
        nodes: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
        edges: [
          { source: "a", target: "b" },
          { source: "b", target: "a" },
        ],
      }),
      params("s1"),
    )
    expect(res.status).toBe(400)
    expect(GraphRepository.replaceGraph).not.toHaveBeenCalled()
  })

  it("200 persists the edited graph and marks ready", async () => {
    asUser()
    vi.mocked(DocumentRepository.findByIdAndUser).mockResolvedValue(DOC as any)
    vi.mocked(GraphRepository.getGraph).mockResolvedValue(GRAPH as any)
    const res = await PATCH(
      patchReq({
        nodes: [
          { id: "a", label: "A", weight_percent: 20 },
          { id: "b", label: "B" },
        ],
        edges: [{ source: "a", target: "b" }],
      }),
      params("s1"),
    )
    expect(res.status).toBe(200)
    expect(GraphRepository.replaceGraph).toHaveBeenCalledTimes(1)
    const [sid, nodes] = vi.mocked(GraphRepository.replaceGraph).mock.calls[0]
    expect(sid).toBe("s1")
    // node "b" depends on "a" (edge a→b)
    expect(nodes.find((n: any) => n.externalId === "b")?.dependencies).toEqual(["a"])
    expect(DocumentRepository.setGraphStatus).toHaveBeenCalledWith("s1", "ready", null)
  })
})
