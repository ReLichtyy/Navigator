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
vi.mock("@/lib/server/repositories/artifact-run.repo", () => ({
  ArtifactRunRepository: { getByIdAndUser: vi.fn() },
}))
vi.mock("@/lib/observability/logger", () => ({ logError: vi.fn() }))

import { requireAuth } from "@/lib/server/utils/auth-helpers"
import { ArtifactRunRepository } from "@/lib/server/repositories/artifact-run.repo"
import { GET } from "../app/api/artifacts/runs/[runId]/route"

const params = { params: Promise.resolve({ runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }) }

describe("GET /api/artifacts/runs/[runId]", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns only a run owned by the authenticated user", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ userId: "u1", role: "free" } as never)
    vi.mocked(ArtifactRunRepository.getByIdAndUser).mockResolvedValue({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      scope_kind: "course",
      scope_id: "c1",
      artifact_type: "course_graph",
      status: "running",
      stage: "enriching",
      progress: 55,
      error: null,
      retryable: true,
      workflow_run_id: "wf-1",
      created_at: "2026-07-24T00:00:00.000Z",
      updated_at: "2026-07-24T00:01:00.000Z",
      completed_at: null,
    })

    const response = await GET(new Request("http://t"), params)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ status: "running", progress: 55 })
    expect(ArtifactRunRepository.getByIdAndUser).toHaveBeenCalledWith(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "u1",
    )
  })

  it("returns 404 without leaking whether another user's run exists", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ userId: "u2", role: "free" } as never)
    vi.mocked(ArtifactRunRepository.getByIdAndUser).mockResolvedValue(undefined)

    const response = await GET(new Request("http://t"), params)
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: "Artifact run not found." })
  })
})

