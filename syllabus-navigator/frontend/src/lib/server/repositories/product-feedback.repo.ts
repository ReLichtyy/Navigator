import { sql } from "@/lib/db"
import type { ProductFeedbackCategory } from "@/lib/ui/product-feedback"

export const PRODUCT_FEEDBACK_JOB_TYPE = "product-feedback-sync"

export type ProductFeedbackSyncStatus = "pending" | "synced" | "failed"

export interface ProductFeedbackRecord {
  id: string
  userId: string
  personName: string
  category: ProductFeedbackCategory
  description: string
  clientRequestId: string
  notionPageId: string | null
  syncStatus: ProductFeedbackSyncStatus
  createdAt: string
}

export interface CreateProductFeedbackInput {
  userId: string
  personName: string
  category: ProductFeedbackCategory
  description: string
  clientRequestId: string
}

interface ProductFeedbackRow {
  id: string
  user_id: string
  person_name: string
  category: ProductFeedbackCategory
  description: string
  client_request_id: string
  notion_page_id: string | null
  notion_sync_status: ProductFeedbackSyncStatus
  created_at: string | Date
  created?: boolean
}

function mapRecord(row: ProductFeedbackRow): ProductFeedbackRecord {
  return {
    id: row.id,
    userId: row.user_id,
    personName: row.person_name,
    category: row.category,
    description: row.description,
    clientRequestId: row.client_request_id,
    notionPageId: row.notion_page_id,
    syncStatus: row.notion_sync_status,
    createdAt:
      row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  }
}

export const ProductFeedbackRepository = {
  /**
   * Create the local source-of-truth row and its delayed Notion retry in one
   * statement. The job contains identifiers only; user-entered content never
   * enters the generic jobs table. The short delay keeps the cron worker from
   * racing the request's immediate reconciliation attempt.
   */
  async createOrGet(
    input: CreateProductFeedbackInput,
  ): Promise<{ record: ProductFeedbackRecord; created: boolean }> {
    const rows = (await sql`
      WITH inserted_feedback AS (
        INSERT INTO product_feedback (
          user_id, person_name, category, description, client_request_id
        )
        VALUES (
          ${input.userId}::uuid,
          ${input.personName},
          ${input.category},
          ${input.description},
          ${input.clientRequestId}::uuid
        )
        ON CONFLICT (user_id, client_request_id) DO NOTHING
        RETURNING id, user_id, person_name, category, description, client_request_id,
                  notion_page_id, notion_sync_status, created_at
      ),
      feedback_row AS (
        SELECT id, user_id, person_name, category, description, client_request_id,
               notion_page_id, notion_sync_status, created_at, TRUE AS created
        FROM inserted_feedback
        UNION ALL
        SELECT id, user_id, person_name, category, description, client_request_id,
               notion_page_id, notion_sync_status, created_at, FALSE AS created
        FROM product_feedback
        WHERE user_id = ${input.userId}::uuid
          AND client_request_id = ${input.clientRequestId}::uuid
          AND NOT EXISTS (SELECT 1 FROM inserted_feedback)
        LIMIT 1
      ),
      queued_job AS (
        INSERT INTO jobs (type, payload, status, max_attempts, scheduled_at)
        SELECT
          ${PRODUCT_FEEDBACK_JOB_TYPE},
          jsonb_build_object('feedbackId', id, 'dedupeKey', id),
          'pending',
          8,
          now() + interval '2 minutes'
        FROM inserted_feedback
        RETURNING id
      )
      SELECT feedback_row.*, (SELECT count(*) FROM queued_job) AS queued_jobs
      FROM feedback_row
    `) as ProductFeedbackRow[]

    let row = rows[0]
    // `ON CONFLICT DO NOTHING` can observe a concurrent unique-key insert that
    // is not visible to this statement's original READ COMMITTED snapshot.
    // The insert has settled by now, so a fresh statement can safely re-read it.
    if (!row) {
      const concurrentRows = (await sql`
        SELECT id, user_id, person_name, category, description, client_request_id,
               notion_page_id, notion_sync_status, created_at, FALSE AS created
        FROM product_feedback
        WHERE user_id = ${input.userId}::uuid
          AND client_request_id = ${input.clientRequestId}::uuid
        LIMIT 1
      `) as ProductFeedbackRow[]
      row = concurrentRows[0]
    }
    if (!row) throw new Error("Unable to persist product feedback")
    return { record: mapRecord(row), created: row.created === true }
  },

  async findById(id: string): Promise<ProductFeedbackRecord | null> {
    const rows = (await sql`
      SELECT id, user_id, person_name, category, description, client_request_id,
             notion_page_id, notion_sync_status, created_at
      FROM product_feedback
      WHERE id = ${id}::uuid
      LIMIT 1
    `) as ProductFeedbackRow[]
    return rows[0] ? mapRecord(rows[0]) : null
  },

  async hasPendingSyncJob(): Promise<boolean> {
    const rows = await sql`
      SELECT 1 AS pending
      FROM jobs
      WHERE type = ${PRODUCT_FEEDBACK_JOB_TYPE}
        AND status IN ('pending', 'processing')
      LIMIT 1
    `
    return rows.length > 0
  },

  /**
   * Acquire the single external-sync lease. A stale lease can be recovered
   * after 15 minutes, well beyond the lifetime of an individual API request.
   */
  async claimForSync(id: string): Promise<ProductFeedbackRecord | null> {
    const rows = (await sql`
      UPDATE product_feedback
      SET sync_started_at = now()
      WHERE id = ${id}::uuid
        AND notion_sync_status IN ('pending', 'failed')
        AND (
          sync_started_at IS NULL
          OR sync_started_at < now() - interval '15 minutes'
        )
      RETURNING id, user_id, person_name, category, description, client_request_id,
                notion_page_id, notion_sync_status, created_at
    `) as ProductFeedbackRow[]
    return rows[0] ? mapRecord(rows[0]) : null
  },

  /** Settle the projection and any still-pending delayed job atomically. */
  async markSynced(id: string, notionPageId: string): Promise<ProductFeedbackRecord | null> {
    const rows = (await sql`
      WITH updated_feedback AS (
        UPDATE product_feedback
        SET notion_page_id = ${notionPageId},
            notion_sync_status = 'synced',
            notion_last_error = NULL,
            sync_started_at = NULL,
            synced_at = now()
        WHERE id = ${id}::uuid
        RETURNING id, user_id, person_name, category, description, client_request_id,
                  notion_page_id, notion_sync_status, created_at
      ),
      settled_jobs AS (
        UPDATE jobs
        SET status = 'completed',
            result = jsonb_build_object(
              'feedbackId', ${id},
              'notionPageId', ${notionPageId}
            ),
            error = NULL,
            completed_at = now()
        WHERE type = ${PRODUCT_FEEDBACK_JOB_TYPE}
          AND payload->>'dedupeKey' = ${id}
          AND status IN ('pending', 'failed')
        RETURNING id
      )
      SELECT updated_feedback.*, (SELECT count(*) FROM settled_jobs) AS settled_jobs
      FROM updated_feedback
    `) as ProductFeedbackRow[]
    return rows[0] ? mapRecord(rows[0]) : null
  },

  async markPending(id: string, reason: string): Promise<void> {
    await sql`
      UPDATE product_feedback
      SET notion_sync_status = 'pending',
          notion_last_error = ${reason.slice(0, 500)},
          sync_started_at = NULL
      WHERE id = ${id}::uuid
    `
  },

  async markFailed(id: string, reason: string): Promise<void> {
    const safeReason = reason.slice(0, 500)
    await sql`
      WITH failed_feedback AS (
        UPDATE product_feedback
        SET notion_sync_status = 'failed',
            notion_last_error = ${safeReason},
            sync_started_at = NULL
        WHERE id = ${id}::uuid
        RETURNING id
      ),
      settled_jobs AS (
        UPDATE jobs
        SET status = 'failed',
            error = ${safeReason},
            completed_at = now()
        WHERE type = ${PRODUCT_FEEDBACK_JOB_TYPE}
          AND payload->>'dedupeKey' = ${id}
          AND status = 'pending'
        RETURNING id
      )
      SELECT
        (SELECT count(*) FROM failed_feedback) AS failed_feedback,
        (SELECT count(*) FROM settled_jobs) AS settled_jobs
    `
  },
}
