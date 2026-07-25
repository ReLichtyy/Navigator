import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db", () => ({ sql: vi.fn() }))
vi.mock("@/lib/observability/logger", () => ({
  logError: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}))
vi.mock("@/lib/server/repositories/course.repo", () => ({
  CourseRepository: { findByIdAndUser: vi.fn() },
}))
vi.mock("@/lib/server/repositories/course-graph.repo", () => ({
  CourseGraphRepository: {
    get: vi.fn(),
    savePreview: vi.fn(),
    markProcessing: vi.fn(),
  },
}))
vi.mock("@/lib/server/repositories/graph.repo", () => ({
  GraphRepository: { getGraph: vi.fn() },
  assignColors: (topics: { externalId: string }[]) =>
    new Map(topics.map((topic) => [topic.externalId, "#5BE39A"])),
}))
vi.mock("@/lib/server/repositories/artifact-run.repo", () => ({
  ArtifactRunRepository: {
    create: vi.fn(),
    attachWorkflowRun: vi.fn(),
    getByIdAndUser: vi.fn(),
  },
}))
vi.mock("@/lib/server/services/artifact-dispatch.service", () => ({
  ArtifactDispatchService: { dispatchCourseGraph: vi.fn() },
}))

import { sql } from "@/lib/db"
import { CourseRepository } from "@/lib/server/repositories/course.repo"
import { CourseGraphRepository } from "@/lib/server/repositories/course-graph.repo"
import { GraphRepository } from "@/lib/server/repositories/graph.repo"
import { ArtifactRunRepository } from "@/lib/server/repositories/artifact-run.repo"
import { ArtifactDispatchService } from "@/lib/server/services/artifact-dispatch.service"
import { CourseGraphService } from "@/lib/server/services/course-graph.service"

const DOC_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const DOC_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"

describe("progressive course-map pipeline", () => {
  beforeEach(() => vi.clearAllMocks())

  it("creates a cited preview and dispatches the expensive generation off-request", async () => {
    vi.mocked(CourseRepository.findByIdAndUser).mockResolvedValue({
      id: "c1",
      user_id: "u1",
      name: "Álgebra",
    } as never)
    vi.mocked(sql).mockResolvedValue([{ id: DOC_A }, { id: DOC_B }] as never)
    vi.mocked(GraphRepository.getGraph)
      .mockResolvedValueOnce({
        topics: [
          {
            id: "topic-a",
            external_id: "matrices",
            label: "Matrices",
            level: 1,
            weight_percent: 60,
            detail: "Operaciones matriciales",
          },
        ],
        edges: [],
        crossLinks: [],
      } as never)
      .mockResolvedValueOnce({
        topics: [
          {
            id: "topic-b",
            external_id: "determinantes",
            label: "Determinantes",
            level: 1,
            weight_percent: 40,
            detail: null,
          },
        ],
        edges: [],
        crossLinks: [],
      } as never)
    vi.mocked(ArtifactRunRepository.create).mockResolvedValue({
      id: "run-1",
      scope_kind: "course",
      scope_id: "c1",
      artifact_type: "course_graph",
      status: "queued",
      stage: "preview",
      progress: 5,
      error: null,
      retryable: true,
      workflow_run_id: null,
      created_at: "2026-07-24T00:00:00.000Z",
      updated_at: "2026-07-24T00:00:00.000Z",
      completed_at: null,
    })
    vi.mocked(ArtifactDispatchService.dispatchCourseGraph).mockResolvedValue("wf-1")

    const run = await CourseGraphService.enqueueRegeneration("u1", "c1", {
      fileIds: [DOC_A, DOC_B],
      focusTopics: ["Matrices"],
    })

    expect(run.status).toBe("queued")
    expect(CourseGraphRepository.savePreview).toHaveBeenCalledWith(
      "c1",
      expect.objectContaining({
        nodes: expect.arrayContaining([
          expect.objectContaining({
            label: "Matrices",
            source_refs: [
              expect.objectContaining({ syllabus_id: DOC_A, topic_id: "topic-a" }),
            ],
          }),
        ]),
      }),
      [DOC_A, DOC_B],
    )
    expect(ArtifactDispatchService.dispatchCourseGraph).toHaveBeenCalledWith({
      runId: "run-1",
      userId: "u1",
      courseId: "c1",
      input: { fileIds: [DOC_A, DOC_B], focusTopics: ["Matrices"] },
    })
    expect(ArtifactRunRepository.attachWorkflowRun).toHaveBeenCalledWith("run-1", "wf-1")
  })

  it("rejects a selection that does not belong to the course before creating a run", async () => {
    vi.mocked(CourseRepository.findByIdAndUser).mockResolvedValue({
      id: "c1",
      user_id: "u1",
      name: "Álgebra",
    } as never)
    vi.mocked(sql).mockResolvedValue([] as never)

    await expect(
      CourseGraphService.enqueueRegeneration("u1", "c1", { fileIds: [DOC_A] }),
    ).rejects.toMatchObject({ status: 400 })
    expect(ArtifactRunRepository.create).not.toHaveBeenCalled()
    expect(ArtifactDispatchService.dispatchCourseGraph).not.toHaveBeenCalled()
  })
})

