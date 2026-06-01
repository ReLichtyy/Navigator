/**
 * queue/index.ts — Async job queue (P1 stub, Neon-backed).
 *
 * P0: Interface + basic Neon implementation.
 * P1: Wire to Upstash QStash or Vercel Cron for background processing.
 */

import { sql } from "@/lib/db"
import { logInfo, logError } from "@/lib/observability/logger"
import type { Job, JobType, QueueAdapter } from "./types"

export const neonQueue: QueueAdapter = {
  async enqueue(type: JobType, payload: Record<string, unknown>, priority = 0): Promise<string> {
    const rows = await sql`
      INSERT INTO jobs (type, payload, priority, status)
      VALUES (${type}, ${JSON.stringify(payload)}::jsonb, ${priority}, 'pending')
      RETURNING id
    `
    const id = (rows as { id: string }[])[0].id
    logInfo("queue.enqueued", { jobId: id, type, priority })
    return id
  },

  async dequeue(): Promise<Job | null> {
    const rows = await sql`
      UPDATE jobs SET status = 'running', started_at = now()
      WHERE id = (
        SELECT id FROM jobs
        WHERE status = 'pending'
        ORDER BY priority DESC, created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *
    `
    const row = (rows as Record<string, unknown>[])[0]
    if (!row) return null
    return row as unknown as Job
  },

  async complete(jobId: string, result?: Record<string, unknown>): Promise<void> {
    await sql`
      UPDATE jobs SET
        status = 'completed',
        result = ${result ? JSON.stringify(result) : null}::jsonb,
        completed_at = now()
      WHERE id = ${jobId}::uuid
    `
    logInfo("queue.completed", { jobId })
  },

  async fail(jobId: string, error: string): Promise<void> {
    await sql`
      UPDATE jobs SET status = 'failed', error = ${error}, completed_at = now()
      WHERE id = ${jobId}::uuid
    `
    logError("queue.failed", { jobId, error })
  },

  async getJob(jobId: string): Promise<Job | null> {
    const rows = await sql`SELECT * FROM jobs WHERE id = ${jobId}::uuid`
    const row = (rows as Record<string, unknown>[])[0]
    return row ? (row as unknown as Job) : null
  },
}

export { neonQueue as queue }
export type { Job, JobType, QueueAdapter } from "./types"
