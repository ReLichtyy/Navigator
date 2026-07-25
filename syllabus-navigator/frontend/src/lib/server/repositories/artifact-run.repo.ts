import { sql } from "@/lib/db"
import type { ArtifactRunAPI, ArtifactRunStatus } from "@/types/api"

export interface CreateArtifactRun {
  userId: string
  scopeKind: "doc" | "course"
  scopeId: string
  artifactType: ArtifactRunAPI["artifact_type"]
  fingerprint: string
  stage?: string
  request?: Record<string, unknown>
}

export const ArtifactRunRepository = {
  async create(input: CreateArtifactRun): Promise<ArtifactRunAPI> {
    const rows = await sql`
      INSERT INTO artifact_runs
        (user_id, scope_kind, scope_id, artifact_type, fingerprint, stage, progress, request)
      VALUES
        (${input.userId}, ${input.scopeKind}, ${input.scopeId}::uuid, ${input.artifactType},
         ${input.fingerprint}, ${input.stage ?? "queued"}, 5,
         ${JSON.stringify(input.request ?? {})}::jsonb)
      RETURNING id, scope_kind, scope_id, artifact_type, status, stage, progress,
                error, retryable, workflow_run_id, created_at, updated_at, completed_at
    `
    return rows[0] as ArtifactRunAPI
  },

  async attachWorkflowRun(runId: string, workflowRunId: string): Promise<void> {
    await sql`
      UPDATE artifact_runs
      SET workflow_run_id = ${workflowRunId}, updated_at = now()
      WHERE id = ${runId}::uuid
    `
  },

  async getByIdAndUser(runId: string, userId: string): Promise<ArtifactRunAPI | undefined> {
    const rows = await sql`
      SELECT id, scope_kind, scope_id, artifact_type, status, stage, progress,
             error, retryable, workflow_run_id, created_at, updated_at, completed_at
      FROM artifact_runs
      WHERE id = ${runId}::uuid AND user_id = ${userId}
    `
    return rows[0] as ArtifactRunAPI | undefined
  },

  async latestForScope(
    userId: string,
    scopeKind: "doc" | "course",
    scopeId: string,
    artifactType: ArtifactRunAPI["artifact_type"],
  ): Promise<ArtifactRunAPI | undefined> {
    const rows = await sql`
      SELECT id, scope_kind, scope_id, artifact_type, status, stage, progress,
             error, retryable, workflow_run_id, created_at, updated_at, completed_at
      FROM artifact_runs
      WHERE user_id = ${userId} AND scope_kind = ${scopeKind}
        AND scope_id = ${scopeId}::uuid AND artifact_type = ${artifactType}
      ORDER BY created_at DESC
      LIMIT 1
    `
    return rows[0] as ArtifactRunAPI | undefined
  },

  async setProgress(runId: string, stage: string, progress: number): Promise<void> {
    const safeProgress = Math.min(99, Math.max(0, Math.trunc(progress)))
    await sql`
      UPDATE artifact_runs
      SET status = 'running', stage = ${stage}, progress = ${safeProgress},
          error = NULL, updated_at = now()
      WHERE id = ${runId}::uuid AND status IN ('queued', 'running')
    `
  },

  async settle(
    runId: string,
    status: Extract<ArtifactRunStatus, "completed" | "failed">,
    error: string | null = null,
    retryable = false,
  ): Promise<void> {
    await sql`
      UPDATE artifact_runs
      SET status = ${status},
          stage = ${status === "completed" ? "completed" : "failed"},
          progress = ${status === "completed" ? 100 : 0},
          error = ${error?.slice(0, 1000) ?? null},
          retryable = ${retryable},
          updated_at = now(),
          completed_at = now()
      WHERE id = ${runId}::uuid
    `
  },
}
