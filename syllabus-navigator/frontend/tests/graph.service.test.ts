import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/server/repositories/document.repo", () => ({
  DocumentRepository: {
    findByIdAndUser: vi.fn(),
    setGraphStatus: vi.fn(),
  },
}))
vi.mock("@/lib/server/repositories/graph.repo", () => ({
  GraphRepository: { getGraph: vi.fn(), replaceGraph: vi.fn() },
}))
vi.mock("@/lib/server/repositories/job.repo", () => ({
  JobRepository: { enqueue: vi.fn() },
}))
vi.mock("@/lib/server/repositories/artifact-run.repo", () => ({
  ArtifactRunRepository: { latestForScope: vi.fn() },
}))
vi.mock("@/lib/server/services/knowledge-pipeline.service", () => ({
  KnowledgePipelineService: { enqueueDocumentGraph: vi.fn() },
}))
vi.mock("@/lib/server/services/study-invalidation.service", () => ({
  StudyInvalidationService: { invalidateDocumentGraph: vi.fn() },
}))

import { DocumentRepository } from "@/lib/server/repositories/document.repo"
import { GraphRepository } from "@/lib/server/repositories/graph.repo"
import { JobRepository } from "@/lib/server/repositories/job.repo"
import { ArtifactRunRepository } from "@/lib/server/repositories/artifact-run.repo"
import { KnowledgePipelineService } from "@/lib/server/services/knowledge-pipeline.service"
import { GraphService } from "@/lib/server/services/graph.service"

const DOC_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const document = {
  id: DOC_ID,
  user_id: "u1",
  status: "processed",
  graph_status: "processing",
  graph_error: null,
  layout: null,
}
const queuedRun = {
  id: "run-1",
  scope_kind: "doc" as const,
  scope_id: DOC_ID,
  artifact_type: "document_graph" as const,
  status: "queued" as const,
  stage: "queued",
  progress: 5,
  error: null,
  retryable: true,
  workflow_run_id: "wf-1",
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-01T00:00:00.000Z",
  completed_at: null,
}

describe("GraphService recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(DocumentRepository.findByIdAndUser).mockResolvedValue(document as never)
    vi.mocked(GraphRepository.getGraph).mockResolvedValue({
      topics: [],
      edges: [],
      crossLinks: [],
    } as never)
    vi.mocked(ArtifactRunRepository.latestForScope).mockResolvedValue(undefined)
    vi.mocked(KnowledgePipelineService.enqueueDocumentGraph).mockResolvedValue(queuedRun)
  })

  it("exposes an orphaned processing state as failed so the user can retry", async () => {
    const graph = await GraphService.getGraph("u1", DOC_ID)

    expect(graph.graph_status).toBe("failed")
    expect(graph.graph_error).toContain("interrumpió")
  })

  it("queues a durable graph run instead of processing the model inline", async () => {
    const run = await GraphService.reprocess("u1", DOC_ID)

    expect(run).toEqual(queuedRun)
    expect(JobRepository.enqueue).toHaveBeenCalledWith(
      "ingest",
      { syllabusId: DOC_ID },
      { kickIfPending: true },
    )
    expect(KnowledgePipelineService.enqueueDocumentGraph).toHaveBeenCalledWith("u1", DOC_ID)
  })
})
