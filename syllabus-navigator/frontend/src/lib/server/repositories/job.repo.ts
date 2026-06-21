import { sql } from "@/lib/db"

export interface DbJob {
  id: string
  type: string
  payload: Record<string, unknown>
  status: string
  attempts: number
  max_attempts: number
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
   * Atomically claim one due pending job (or a stuck 'processing' one older than
   * staleMinutes). Increments `attempts` on claim. Returns null when there's
   * nothing to do. The UPDATE ... RETURNING is the lock: two concurrent workers
   * can't grab the same row. Pending jobs are only claimed once `scheduled_at`
   * is due, which is how retry backoff is enforced (see `fail`).
   */
  async claimNext(type: string, staleMinutes = 10): Promise<DbJob | null> {
    const rows = await sql`
      UPDATE jobs
      SET status = 'processing', started_at = now(), attempts = attempts + 1
      WHERE id = (
        SELECT id FROM jobs
        WHERE type = ${type}
          AND (
            (status = 'pending' AND scheduled_at <= now())
            OR (status = 'processing' AND started_at < now() - (${staleMinutes} || ' minutes')::interval)
          )
        ORDER BY priority DESC, scheduled_at ASC, created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING id, type, payload, status, attempts, max_attempts, result, error
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

  /**
   * Mark a job failed. If it still has attempts left (`attempts < max_attempts`,
   * where `attempts` was already incremented on claim) it is re-queued to
   * 'pending' with exponential backoff (2^attempts minutes) instead of failing
   * permanently. Returns whether the job will be retried.
   */
  async fail(jobId: string, error: string, permanent = false): Promise<{ retried: boolean }> {
    // `permanent` skips backoff retry for unrecoverable errors (e.g. bad payload).
    const canRetry = !permanent
    const rows = await sql`
      UPDATE jobs
      SET
        status       = CASE WHEN ${canRetry} AND attempts < max_attempts THEN 'pending' ELSE 'failed' END,
        error        = ${error.slice(0, 2000)},
        scheduled_at = CASE WHEN ${canRetry} AND attempts < max_attempts
                         THEN now() + (power(2, attempts) || ' minutes')::interval
                         ELSE scheduled_at END,
        started_at   = NULL,
        completed_at = CASE WHEN ${canRetry} AND attempts < max_attempts THEN NULL ELSE now() END
      WHERE id = ${jobId}::uuid
      RETURNING status
    `
    return { retried: (rows[0] as { status: string } | undefined)?.status === "pending" }
  },
}
