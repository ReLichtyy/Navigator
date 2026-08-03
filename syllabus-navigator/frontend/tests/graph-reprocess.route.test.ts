import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/server/utils/auth-helpers", () => {
  class ApiErrorResponse extends Error {
    constructor(
      message: string,
      public status: number,
    ) {
      super(message)
    }
  }
  return { requireAuth: vi.fn(), ApiErrorResponse }
})
vi.mock("@/lib/server/services/graph.service", () => ({
  GraphService: { reprocess: vi.fn() },
}))
vi.mock("@/lib/server/services/ingestion.service", () => ({
  IngestionService: { drainForSyllabus: vi.fn() },
}))
vi.mock("@/lib/observability/logger", () => ({ logError: vi.fn(), logInfo: vi.fn() }))

import { requireAuth } from "@/lib/server/utils/auth-helpers"
import { GraphService } from "@/lib/server/services/graph.service"
import { IngestionService } from "@/lib/server/services/ingestion.service"
import { POST } from "../app/api/graph/[syllabusId]/reprocess/route"

const DOC_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const params = { params: Promise.resolve({ syllabusId: DOC_ID }) }

describe("POST /api/graph/[syllabusId]/reprocess", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns 202 with a durable run without executing the LLM in the request", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ userId: "u1", role: "free" } as never)
    vi.mocked(GraphService.reprocess).mockResolvedValue({
      id: "run-1",
      scope_kind: "doc",
      scope_id: DOC_ID,
      artifact_type: "document_graph",
      status: "queued",
      stage: "queued",
      progress: 5,
      error: null,
      retryable: true,
      workflow_run_id: "wf-1",
      created_at: "2026-08-01T00:00:00.000Z",
      updated_at: "2026-08-01T00:00:00.000Z",
      completed_at: null,
    } as never)

    const response = await POST(new Request("http://t", { method: "POST" }), params)

    expect(response.status).toBe(202)
    expect(await response.json()).toMatchObject({ id: "run-1", artifact_type: "document_graph" })
    expect(IngestionService.drainForSyllabus).not.toHaveBeenCalled()
  })
})
