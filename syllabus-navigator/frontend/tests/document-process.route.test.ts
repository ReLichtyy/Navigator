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
vi.mock("@/lib/server/services/knowledge-pipeline.service", () => ({
  KnowledgePipelineService: { enqueueDocument: vi.fn() },
}))
vi.mock("@/lib/cache", () => ({ invalidatePrefix: vi.fn() }))
vi.mock("@/lib/observability/logger", () => ({ logError: vi.fn(), logInfo: vi.fn() }))

import { requireAuth } from "@/lib/server/utils/auth-helpers"
import { KnowledgePipelineService } from "@/lib/server/services/knowledge-pipeline.service"
import { POST } from "../app/api/upload/[id]/process/route"

const DOC_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const params = { params: Promise.resolve({ id: DOC_ID }) }
const queuedRun = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  scope_kind: "doc" as const,
  scope_id: DOC_ID,
  artifact_type: "document_inventory" as const,
  status: "queued" as const,
  stage: "queued",
  progress: 5,
  error: null,
  retryable: true,
  workflow_run_id: null,
  created_at: "2026-07-24T00:00:00.000Z",
  updated_at: "2026-07-24T00:00:00.000Z",
  completed_at: null,
}

describe("POST /api/upload/[id]/process", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns a pollable artifact run and dispatches the durable workflow", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ userId: "u1", role: "free" } as never)
    vi.mocked(KnowledgePipelineService.enqueueDocument).mockResolvedValue({
      ...queuedRun,
      workflow_run_id: "wf-1",
    })

    const response = await POST(new Request("http://t"), params)

    expect(response.status).toBe(202)
    expect(await response.json()).toMatchObject({
      id: queuedRun.id,
      artifact_type: "document_inventory",
      workflow_run_id: "wf-1",
    })
    expect(KnowledgePipelineService.enqueueDocument).toHaveBeenCalledWith("u1", DOC_ID)
  })

  it("reuses an already-dispatched run without starting a duplicate workflow", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ userId: "u1", role: "free" } as never)
    vi.mocked(KnowledgePipelineService.enqueueDocument).mockResolvedValue({
      ...queuedRun,
      workflow_run_id: "wf-existing",
    })

    const response = await POST(new Request("http://t"), params)

    expect(response.status).toBe(202)
    expect(KnowledgePipelineService.enqueueDocument).toHaveBeenCalledTimes(1)
    expect(await response.json()).toMatchObject({ workflow_run_id: "wf-existing" })
  })
})
