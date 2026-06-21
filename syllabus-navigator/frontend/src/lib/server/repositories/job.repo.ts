import { sql } from "@/lib/db"

export interface DbJob {
  id: string
  type: string
  payload: Record<string, unknown>
  status: string
  result: Record<string, unknown> | null
  error: string | null
}

export const JobRepository = {
  /** Enqueue a job. */
  async enqueue(type: string, payload: Record<string, unknown>): Promise<string> {
    const rows = await sql`
      INSERT INTO jobs (type, payload, status)
      VALUES (${type}, ${JSON.stringify(payload)}::jsonb, 'pending')
      RETURNING id
    `
    return (rows[0] as { id: string }).id
  },

  /**
   * Atomically claim one pending job (or a stuck 'processing' one older than
   * staleMinutes). Returns null when there's nothing to do. The UPDATE ...
   * RETURNING is the lock: two concurrent workers can't grab the same row.
   */
  async claimNext(type: string, staleMinutes = 10): Promise<DbJob | null> {
    const rows = await sql`
      UPDATE jobs
      SET status = 'processing', started_at = now()
      WHERE id = (
        SELECT id FROM jobs
        WHERE type = ${type}
          AND (
            status = 'pending'
            OR (status = 'processing' AND started_at < now() - (${staleMinutes} || ' minutes')::interval)
          )
        ORDER BY priority DESC, created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING id, type, payload, status, result, error
    `
    return (rows[0] as DbJob) ?? null
  },

  async complete(jobId: string, result: Record<string, unknown>): Promise<void> {
    await sql`
      UPDATE jobs
      SET status = 'completed', result = ${JSON.stringify(result)}::jsonb, completed_at = now()
      WHERE id = ${jobId}::uuid
    `
  },

  async fail(jobId: string, error: string): Promise<void> {
    await sql`
      UPDATE jobs
      SET status = 'failed', error = ${error.slice(0, 2000)}, completed_at = now()
      WHERE id = ${jobId}::uuid
    `
  },
}
