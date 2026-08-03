/**
 * course-graph.route.test.ts — whole-course mind map routes:
 * GET/PATCH /api/graph/course/[courseId] + POST .../regenerate.
 * Exercises the real CourseGraphService with mocked repos/LLM (no DB).
 */
import { describe, it, expect, beforeEach, vi } from "vitest"

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
vi.mock("@/lib/observability/logger", () => ({
  logError: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}))
vi.mock("@/lib/db", () => ({ sql: vi.fn() }))
vi.mock("@/lib/server/repositories/course.repo", () => ({
  CourseRepository: { findByIdAndUser: vi.fn() },
}))
vi.mock("@/lib/server/repositories/course-graph.repo", () => ({
  CourseGraphRepository: {
    get: vi.fn(),
    savePreview: vi.fn(),
    markProcessing: vi.fn(),
    saveData: vi.fn(),
    markFailed: vi.fn(),
    replaceData: vi.fn(),
  },
}))
vi.mock("@/lib/server/repositories/chunk.repo", () => ({
  ChunkRepository: { getConcatenatedTextByDocs: vi.fn() },
}))
vi.mock("@/lib/server/repositories/graph.repo", () => ({
  GraphRepository: { getGraph: vi.fn() },
  assignColors: (topics: { externalId: string }[]) =>
    new Map(topics.map((topic) => [topic.externalId, "#5BE39A"])),
}))
vi.mock("@/lib/server/services/study-invalidation.service", () => ({
  StudyInvalidationService: { invalidateCourseGraph: vi.fn() },
}))
vi.mock("@/lib/server/repositories/artifact-run.repo", () => ({
  ArtifactRunRepository: {
    create: vi.fn(),
    claimDispatch: vi.fn(),
    attachWorkflowRun: vi.fn(),
    releaseDispatchClaim: vi.fn(),
    latestForScope: vi.fn(),
    settle: vi.fn(),
  },
}))
vi.mock("@/lib/server/services/artifact-dispatch.service", () => ({
  ArtifactDispatchService: { dispatchCourseGraph: vi.fn() },
}))
vi.mock("@/lib/server/rag/graph-gen", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/server/rag/graph-gen")>()
  return { ...real, extractGraphFromText: vi.fn() }
})

import { requireAuth, ApiErrorResponse } from "@/lib/server/utils/auth-helpers"
import { CourseRepository } from "@/lib/server/repositories/course.repo"
import { CourseGraphRepository } from "@/lib/server/repositories/course-graph.repo"
import { ChunkRepository } from "@/lib/server/repositories/chunk.repo"
import { GraphRepository } from "@/lib/server/repositories/graph.repo"
import { StudyInvalidationService } from "@/lib/server/services/study-invalidation.service"
import { extractGraphFromText } from "@/lib/server/rag/graph-gen"
import { ArtifactRunRepository } from "@/lib/server/repositories/artifact-run.repo"
import { ArtifactDispatchService } from "@/lib/server/services/artifact-dispatch.service"
import { sql } from "@/lib/db"
import { GET, PATCH } from "../app/api/graph/course/[courseId]/route"
import { POST } from "../app/api/graph/course/[courseId]/regenerate/route"

const params = (courseId: string) => ({ params: Promise.resolve({ courseId }) })
const asUser = (id = "u1", role = "free") =>
  vi.mocked(requireAuth).mockResolvedValue({ userId: id, role } as any)

const COURSE = { id: "c1", user_id: "u1", name: "Álgebra" }
const DOC_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const DOC_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"

const ROW = {
  course_id: "c1",
  data: {
    layout: "radial",
    nodes: [
      {
        id: "n1",
        label: "Matrices",
        weight_percent: 60,
        level: 1,
        parent_id: null,
        detail: null,
        color: "#5BE39A",
      },
    ],
    edges: [],
    crossLinks: [],
  },
  source_doc_ids: [DOC_A],
  status: "ready",
  error: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(ArtifactRunRepository.latestForScope).mockResolvedValue(undefined)
  vi.mocked(ArtifactRunRepository.claimDispatch).mockResolvedValue(true)
})

describe("GET /api/graph/course/[courseId]", () => {
  it("401 when unauthenticated", async () => {
    vi.mocked(requireAuth).mockRejectedValue(new ApiErrorResponse("Unauthorized", 401))
    const res = await GET(new Request("http://t"), params("c1"))
    expect(res.status).toBe(401)
  })

  it("403 for guests", async () => {
    asUser("u1", "guest")
    const res = await GET(new Request("http://t"), params("c1"))
    expect(res.status).toBe(403)
  })

  it("404 when the course isn't the caller's", async () => {
    asUser()
    vi.mocked(CourseRepository.findByIdAndUser).mockResolvedValue(undefined)
    const res = await GET(new Request("http://t"), params("c1"))
    expect(res.status).toBe(404)
  })

  it('returns graph_status "none" when never generated', async () => {
    asUser()
    vi.mocked(CourseRepository.findByIdAndUser).mockResolvedValue(COURSE as any)
    vi.mocked(CourseGraphRepository.get).mockResolvedValue(undefined)
    const res = await GET(new Request("http://t"), params("c1"))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toMatchObject({
      course_id: "c1",
      graph_status: "none",
      nodes: [],
      source_doc_ids: [],
    })
  })

  it("returns the stored graph + persisted doc selection", async () => {
    asUser()
    vi.mocked(CourseRepository.findByIdAndUser).mockResolvedValue(COURSE as any)
    vi.mocked(CourseGraphRepository.get).mockResolvedValue(ROW as any)
    const body = await (await GET(new Request("http://t"), params("c1"))).json()
    expect(body.graph_status).toBe("ready")
    expect(body.nodes).toHaveLength(1)
    expect(body.source_doc_ids).toEqual([DOC_A])
  })

  it("turns an abandoned processing row into a recoverable failed state", async () => {
    asUser()
    vi.mocked(CourseRepository.findByIdAndUser).mockResolvedValue(COURSE as any)
    vi.mocked(CourseGraphRepository.get).mockResolvedValue({
      ...ROW,
      data: null,
      status: "processing",
    } as any)
    vi.mocked(ArtifactRunRepository.latestForScope).mockResolvedValue({
      id: "run-old",
      status: "failed",
      error: "Workflow interrumpido",
    } as any)

    const body = await (await GET(new Request("http://t"), params("c1"))).json()

    expect(body.graph_status).toBe("failed")
    expect(body.graph_error).toBe("Workflow interrumpido")
  })
})

describe("POST /api/graph/course/[courseId]/regenerate", () => {
  const req = (body: unknown) =>
    new Request("http://t", { method: "POST", body: JSON.stringify(body) })

  it("400 on empty fileIds", async () => {
    asUser()
    const res = await POST(req({ fileIds: [] }), params("c1"))
    expect(res.status).toBe(400)
  })

  it("400 when no selected doc is a processed doc of the course", async () => {
    asUser()
    vi.mocked(CourseRepository.findByIdAndUser).mockResolvedValue(COURSE as any)
    vi.mocked(sql).mockResolvedValue([] as any)
    const res = await POST(req({ fileIds: [DOC_A] }), params("c1"))
    expect(res.status).toBe(400)
    expect(CourseGraphRepository.markProcessing).not.toHaveBeenCalled()
  })

  it("creates a preview, queues durable generation and returns 202", async () => {
    asUser()
    vi.mocked(CourseRepository.findByIdAndUser).mockResolvedValue(COURSE as any)
    vi.mocked(sql).mockResolvedValue([{ id: DOC_A }, { id: DOC_B }] as any)
    vi.mocked(GraphRepository.getGraph).mockResolvedValue({
      topics: [{ id: "t1", external_id: "edited", label: "Tema editado", level: 1 }],
      edges: [],
      crossLinks: [],
    } as any)
    vi.mocked(ArtifactRunRepository.create).mockResolvedValue({
      id: "run-1",
      status: "queued",
      stage: "preview",
      progress: 5,
    } as any)
    vi.mocked(ArtifactDispatchService.dispatchCourseGraph).mockResolvedValue("workflow-1")

    const res = await POST(
      req({ fileIds: [DOC_A, DOC_B], focusTopics: ["Matrices"], instructions: "sencillo" }),
      params("c1"),
    )
    expect(res.status).toBe(202)
    expect(await res.json()).toMatchObject({ id: "run-1", status: "queued" })
    expect(CourseGraphRepository.savePreview).toHaveBeenCalled()
    expect(ArtifactDispatchService.dispatchCourseGraph).toHaveBeenCalled()
    expect(extractGraphFromText).not.toHaveBeenCalled()
  })

  it("queues a selected branch refinement without rebuilding it in the request", async () => {
    asUser()
    vi.mocked(CourseRepository.findByIdAndUser).mockResolvedValue(COURSE as any)
    vi.mocked(sql).mockResolvedValue([{ id: DOC_A }] as any)
    vi.mocked(GraphRepository.getGraph).mockResolvedValue({
      topics: [{ id: "t1", external_id: "n1", label: "Matrices", level: 1 }],
      edges: [],
      crossLinks: [],
    } as any)
    vi.mocked(ArtifactRunRepository.create).mockResolvedValue({
      id: "run-branch",
      status: "queued",
    } as any)
    vi.mocked(ArtifactDispatchService.dispatchCourseGraph).mockResolvedValue("workflow-branch")

    const res = await POST(
      req({ fileIds: [DOC_A], branchId: "n1", branchMode: "expand" }),
      params("c1"),
    )

    expect(res.status).toBe(202)
    expect(ArtifactDispatchService.dispatchCourseGraph).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ branchId: "n1", branchMode: "expand" }),
      }),
    )
    expect(extractGraphFromText).not.toHaveBeenCalled()
  })

  it("marks the run recoverable and returns 502 when dispatch fails", async () => {
    asUser()
    vi.mocked(CourseRepository.findByIdAndUser).mockResolvedValue(COURSE as any)
    vi.mocked(sql).mockResolvedValue([{ id: DOC_A }] as any)
    vi.mocked(GraphRepository.getGraph).mockResolvedValue({
      topics: [{ id: "t1", external_id: "n1", label: "Tema", level: 1 }],
      edges: [],
      crossLinks: [],
    } as any)
    vi.mocked(ArtifactRunRepository.create).mockResolvedValue({
      id: "run-1",
      status: "queued",
    } as any)
    vi.mocked(ArtifactDispatchService.dispatchCourseGraph).mockRejectedValue(new Error("boom"))
    const res = await POST(req({ fileIds: [DOC_A] }), params("c1"))
    expect(res.status).toBe(502)
    expect(CourseGraphRepository.markFailed).toHaveBeenCalledWith("c1", "boom", "run-1")
    expect(ArtifactRunRepository.settle).toHaveBeenCalledWith("run-1", "failed", "boom", true)
  })

  it("queues even when a processed document has no prior graph preview", async () => {
    asUser()
    vi.mocked(CourseRepository.findByIdAndUser).mockResolvedValue(COURSE as any)
    vi.mocked(sql).mockResolvedValue([{ id: DOC_A }] as any)
    vi.mocked(GraphRepository.getGraph).mockResolvedValue({
      topics: [],
      edges: [],
      crossLinks: [],
    } as any)
    vi.mocked(ArtifactRunRepository.create).mockResolvedValue({
      id: "run-1",
      status: "queued",
    } as any)
    vi.mocked(ArtifactDispatchService.dispatchCourseGraph).mockResolvedValue("workflow-1")
    const res = await POST(req({ fileIds: [DOC_A] }), params("c1"))
    expect(res.status).toBe(202)
    expect(CourseGraphRepository.markProcessing).toHaveBeenCalledWith("c1", [DOC_A], "run-1")
  })
})

describe("PATCH /api/graph/course/[courseId]", () => {
  const req = (body: unknown) =>
    new Request("http://t", { method: "PATCH", body: JSON.stringify(body) })

  it("saves a valid edited tree and returns the fresh graph", async () => {
    asUser()
    vi.mocked(CourseRepository.findByIdAndUser).mockResolvedValue(COURSE as any)
    vi.mocked(CourseGraphRepository.get).mockResolvedValue(ROW as any)
    const res = await PATCH(
      req({
        nodes: [
          { id: "n1", label: "Matrices", level: 1, parentId: null },
          { id: "n2", label: "Determinantes", level: 2, parentId: "n1", detail: "Sarrus" },
        ],
        edges: [],
        crossLinks: [],
      }),
      params("c1"),
    )
    expect(res.status).toBe(200)
    const saved = vi.mocked(CourseGraphRepository.replaceData).mock.calls[0][1]
    expect(saved.nodes.find((n: any) => n.id === "n2")?.detail).toBe("Sarrus")
    expect(StudyInvalidationService.invalidateCourseGraph).toHaveBeenCalledWith("c1")
  })

  it("400 on an invalid tree (level jump)", async () => {
    asUser()
    vi.mocked(CourseRepository.findByIdAndUser).mockResolvedValue(COURSE as any)
    vi.mocked(CourseGraphRepository.get).mockResolvedValue(ROW as any)
    const res = await PATCH(
      req({
        nodes: [
          { id: "n1", label: "A", level: 1, parentId: null },
          { id: "n3", label: "C", level: 3, parentId: "n1" },
        ],
        edges: [],
        crossLinks: [],
      }),
      params("c1"),
    )
    expect(res.status).toBe(400)
    expect(CourseGraphRepository.replaceData).not.toHaveBeenCalled()
  })

  it("400 on a prerequisite cycle", async () => {
    asUser()
    vi.mocked(CourseRepository.findByIdAndUser).mockResolvedValue(COURSE as any)
    vi.mocked(CourseGraphRepository.get).mockResolvedValue(ROW as any)
    const res = await PATCH(
      req({
        nodes: [
          { id: "a", label: "A", level: 1, parentId: null },
          { id: "b", label: "B", level: 1, parentId: null },
        ],
        edges: [
          { source: "a", target: "b" },
          { source: "b", target: "a" },
        ],
        crossLinks: [],
      }),
      params("c1"),
    )
    expect(res.status).toBe(400)
  })
})
