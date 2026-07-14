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
  /**
   * Enqueue a job, deduplicating on a payload key: if a pending or processing job
   * for the same type + key already exists, returns the existing job's id instead
   * of inserting a duplicate. By default the key is `payload.syllabusId`; pass
   * `opts.dedupeKey` to dedupe on a `payload.dedupeKey` value instead (used by
   * study-bank jobs, which key on scope+type+difficulty, not a syllabus).
   *
   * `kickIfPending` is for user-initiated retries (e.g. the Reprocess button):
   * on a dedupe-hit against a 'pending' job it resets `scheduled_at` to now so
   * the job is claimable immediately instead of waiting out the retry backoff.
   * Automatic callers must not set it — they respect the backoff window.
   */
  async enqueue(
    type: string,
    payload: Record<string, unknown>,
    opts?: { kickIfPending?: boolean; dedupeKey?: string },
  ): Promise<string> {
    // Generic dedupe: an explicit dedupeKey matches `payload->>'dedupeKey'`;
    // otherwise fall back to the legacy syllabusId key.
    const keyField = opts?.dedupeKey ? "dedupeKey" : "syllabusId"
    const keyValue = opts?.dedupeKey ?? (payload.syllabusId as string | undefined)
    if (keyValue) {
      const existing = await sql`
        SELECT id, status FROM jobs
        WHERE type = ${type}
          AND payload->>${keyField} = ${keyValue}
          AND status IN ('pending', 'processing')
        LIMIT 1
      `
      if (existing.length > 0) {
        const job = existing[0] as { id: string; status: string }
        if (opts?.kickIfPending && job.status === "pending") {
          await sql`UPDATE jobs SET scheduled_at = now() WHERE id = ${job.id}::uuid`
        }
        return job.id
      }
    }

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
   *
   * `filter` narrows the claim to one job: `syllabusId` (targeted drain for a
   * user-initiated reprocess) or `dedupeKey` (a study-bank job for one
   * scope+difficulty, so a serve request only ever advances ITS OWN bank).
   * Omitted → global queue order.
   */
  async claimNext(
    type: string,
    staleMinutes = 10,
    filter?: { syllabusId?: string; dedupeKey?: string },
  ): Promise<DbJob | null> {
    const syllabusFilter = filter?.syllabusId ?? null
    const dedupeFilter = filter?.dedupeKey ?? null
    const rows = await sql`
      UPDATE jobs
      SET status = 'processing', started_at = now(), attempts = attempts + 1
      WHERE id = (
        SELECT id FROM jobs
        WHERE type = ${type}
          AND (${syllabusFilter}::text IS NULL OR payload->>'syllabusId' = ${syllabusFilter})
          AND (${dedupeFilter}::text IS NULL OR payload->>'dedupeKey' = ${dedupeFilter})
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

  /** Is a job for this type + dedupeKey still pending or processing? */
  async hasPending(type: string, dedupeKey: string): Promise<boolean> {
    const rows = await sql`
      SELECT 1 FROM jobs
      WHERE type = ${type}
        AND payload->>'dedupeKey' = ${dedupeKey}
        AND status IN ('pending', 'processing')
      LIMIT 1
    `
    return rows.length > 0
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
