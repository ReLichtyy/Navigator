import { z } from "zod"
import type { DbJob } from "@/lib/server/repositories/job.repo"
import { JobRepository } from "@/lib/server/repositories/job.repo"
import {
  PRODUCT_FEEDBACK_JOB_TYPE,
  ProductFeedbackRepository,
  type CreateProductFeedbackInput,
  type ProductFeedbackRecord,
} from "@/lib/server/repositories/product-feedback.repo"
import {
  checkNotionFeedbackReadiness,
  isNotionFeedbackConfigured,
  syncProductFeedbackToNotion,
  type NotionFeedbackReadiness,
  type NotionFeedbackSyncResult,
} from "@/lib/server/integrations/notion-feedback"
import type { ProductFeedbackInput } from "@/lib/server/validators/api.schemas"
import { logError, logInfo, logWarn } from "@/lib/observability/logger"

const ProductFeedbackJobPayloadSchema = z
  .object({
    feedbackId: z.string().uuid(),
    dedupeKey: z.string().uuid(),
  })
  .strict()
  .refine((value) => value.feedbackId === value.dedupeKey)

type SubmitRepository = Pick<
  typeof ProductFeedbackRepository,
  "createOrGet" | "claimForSync" | "markSynced" | "markPending"
>

export interface ProductFeedbackServiceDependencies {
  repository: SubmitRepository
  syncFeedback: (feedback: {
    id: string
    personName: string
    category: ProductFeedbackRecord["category"]
    description: string
    createdAt: string
  }) => Promise<NotionFeedbackSyncResult>
  enqueueSync: (feedbackId: string) => Promise<unknown>
}

export interface ProductFeedbackQueueDependencies {
  isConfigured: () => boolean
  hasPendingSyncJob: () => Promise<boolean>
  checkReadiness: () => Promise<NotionFeedbackReadiness>
  repository: Pick<
    typeof ProductFeedbackRepository,
    "findById" | "claimForSync" | "markSynced" | "markPending" | "markFailed"
  >
  claimNext: () => Promise<DbJob | null>
  completeJob: (jobId: string, result: Record<string, unknown>) => Promise<void>
  failJob: (jobId: string, reason: string, permanent: boolean) => Promise<{ retried: boolean }>
  syncFeedback: ProductFeedbackServiceDependencies["syncFeedback"]
}

export interface ProductFeedbackReceipt {
  feedback: {
    id: string
    createdAt: string
    syncStatus: "pending" | "synced"
  }
}

export class ProductFeedbackConflictError extends Error {
  constructor() {
    super("El ID de solicitud ya fue utilizado para otro feedback.")
    this.name = "ProductFeedbackConflictError"
  }
}

function notionPayload(record: ProductFeedbackRecord) {
  return {
    id: record.id,
    personName: record.personName,
    category: record.category,
    description: record.description,
    createdAt: record.createdAt,
  }
}

function receipt(
  record: ProductFeedbackRecord,
  syncStatus: "pending" | "synced" = record.syncStatus === "synced" ? "synced" : "pending",
): ProductFeedbackReceipt {
  return {
    feedback: {
      id: record.id,
      createdAt: record.createdAt,
      syncStatus,
    },
  }
}

async function enqueueSync(feedbackId: string): Promise<void> {
  await JobRepository.enqueue(
    PRODUCT_FEEDBACK_JOB_TYPE,
    { feedbackId, dedupeKey: feedbackId },
    { dedupeKey: feedbackId },
  )
}

const defaultSubmitDependencies: ProductFeedbackServiceDependencies = {
  repository: ProductFeedbackRepository,
  syncFeedback: syncProductFeedbackToNotion,
  enqueueSync,
}

async function ensureReplayIsQueued(
  feedbackId: string,
  created: boolean,
  dependencies: ProductFeedbackServiceDependencies,
): Promise<void> {
  // A newly created row already has a delayed job from the same SQL statement.
  if (created) return

  try {
    await dependencies.enqueueSync(feedbackId)
  } catch (error) {
    // The feedback is already durable. An auxiliary reconciliation failure
    // must never turn that successful write into a 500 response.
    logError("product_feedback.enqueue_error", {
      feedbackId,
      errorType: error instanceof Error ? error.name : "unknown",
    })
  }
}

/** Persist first, then best-effort reconcile to Notion. */
export async function submitProductFeedback(
  context: { userId: string; personName: string },
  input: ProductFeedbackInput,
  dependencies: ProductFeedbackServiceDependencies = defaultSubmitDependencies,
): Promise<ProductFeedbackReceipt> {
  const persisted = await dependencies.repository.createOrGet({
    userId: context.userId,
    personName: context.personName,
    ...input,
  } satisfies CreateProductFeedbackInput)
  const record = persisted.record

  if (
    !persisted.created &&
    (record.category !== input.category || record.description !== input.description)
  ) {
    throw new ProductFeedbackConflictError()
  }
  if (record.syncStatus === "synced") return receipt(record, "synced")

  const claimed = await dependencies.repository.claimForSync(record.id)
  if (!claimed) return receipt(record, "pending")

  let result: NotionFeedbackSyncResult
  try {
    result = await dependencies.syncFeedback(notionPayload(claimed))
  } catch (error) {
    const reason = "sync_exception"
    await dependencies.repository.markPending(record.id, reason)
    await ensureReplayIsQueued(record.id, persisted.created, dependencies)
    logError("product_feedback.immediate_sync_error", {
      feedbackId: record.id,
      errorType: error instanceof Error ? error.name : "unknown",
    })
    return receipt(record, "pending")
  }

  if (result.status === "synced") {
    const synced = await dependencies.repository.markSynced(record.id, result.pageId)
    logInfo("product_feedback.synced", { feedbackId: record.id })
    return receipt(synced ?? { ...record, syncStatus: "synced" }, "synced")
  }

  if (result.reason === "not_configured") {
    await dependencies.repository.markPending(record.id, result.reason)
    return receipt(record, "pending")
  }

  if (result.retryable === true) {
    await dependencies.repository.markPending(record.id, result.reason)
    await ensureReplayIsQueued(record.id, persisted.created, dependencies)
  } else {
    // Access/schema errors can be fixed by an operator. Keep the atomic job
    // pending so the queue preflight can resume it without user resubmission.
    await dependencies.repository.markPending(record.id, result.reason)
  }

  return receipt(record, "pending")
}

const defaultQueueDependencies: ProductFeedbackQueueDependencies = {
  isConfigured: isNotionFeedbackConfigured,
  hasPendingSyncJob: () => ProductFeedbackRepository.hasPendingSyncJob(),
  checkReadiness: () => checkNotionFeedbackReadiness(),
  repository: ProductFeedbackRepository,
  claimNext: () => JobRepository.claimNext(PRODUCT_FEEDBACK_JOB_TYPE),
  completeJob: (jobId, result) => JobRepository.complete(jobId, result),
  failJob: (jobId, reason, permanent) => JobRepository.fail(jobId, reason, permanent),
  syncFeedback: syncProductFeedbackToNotion,
}

export interface ProductFeedbackQueueResult {
  processed: number
  failed: number
  retried: number
  deferred: boolean
  deferredReason?: string
}

/**
 * Drain retries only when both Notion variables exist. Checking before the
 * first claim is deliberate: preconfiguration must not consume job attempts.
 */
export async function drainProductFeedbackSyncQueue(
  maxJobs = 3,
  dependencies: ProductFeedbackQueueDependencies = defaultQueueDependencies,
): Promise<ProductFeedbackQueueResult> {
  const tally: ProductFeedbackQueueResult = {
    processed: 0,
    failed: 0,
    retried: 0,
    deferred: false,
  }
  if (!dependencies.isConfigured()) {
    return { ...tally, deferred: true, deferredReason: "not_configured" }
  }
  if (!(await dependencies.hasPendingSyncJob())) return tally
  const readiness = await dependencies.checkReadiness()
  if (!readiness.ready) {
    logWarn("product_feedback.queue_deferred", { reason: readiness.reason })
    return { ...tally, deferred: true, deferredReason: readiness.reason }
  }

  const limit = Math.max(0, Math.min(10, Math.trunc(maxJobs)))
  for (let index = 0; index < limit; index++) {
    const job = await dependencies.claimNext()
    if (!job) break

    const payload = ProductFeedbackJobPayloadSchema.safeParse(job.payload)
    if (!payload.success) {
      await dependencies.failJob(job.id, "invalid_feedback_job_payload", true)
      tally.failed++
      continue
    }
    const { feedbackId } = payload.data

    const record = await dependencies.repository.findById(feedbackId)
    if (!record) {
      await dependencies.failJob(job.id, "feedback_not_found", true)
      tally.failed++
      continue
    }
    if (record.syncStatus === "synced") {
      await dependencies.completeJob(job.id, {
        feedbackId,
        notionPageId: record.notionPageId,
      })
      tally.processed++
      continue
    }

    const claimed = await dependencies.repository.claimForSync(feedbackId)
    if (!claimed) {
      const settled = await dependencies.failJob(job.id, "feedback_sync_in_progress", false)
      if (settled.retried) tally.retried++
      else tally.failed++
      continue
    }

    try {
      const result = await dependencies.syncFeedback(notionPayload(claimed))
      if (result.status === "synced") {
        await dependencies.repository.markSynced(feedbackId, result.pageId)
        await dependencies.completeJob(job.id, {
          feedbackId,
          notionPageId: result.pageId,
        })
        tally.processed++
        continue
      }

      const retryable = result.retryable === true || result.reason === "not_configured"
      if (retryable) {
        await dependencies.repository.markPending(feedbackId, result.reason)
      } else {
        await dependencies.repository.markFailed(feedbackId, result.reason)
      }
      const settled = await dependencies.failJob(job.id, result.reason, !retryable)
      if (settled.retried) tally.retried++
      else {
        if (retryable) await dependencies.repository.markFailed(feedbackId, result.reason)
        tally.failed++
      }
    } catch (error) {
      await dependencies.repository.markPending(feedbackId, "sync_exception")
      const settled = await dependencies.failJob(job.id, "sync_exception", false)
      if (settled.retried) tally.retried++
      else {
        await dependencies.repository.markFailed(feedbackId, "sync_exception")
        tally.failed++
      }
      logError("product_feedback.worker_sync_error", {
        jobId: job.id,
        feedbackId,
        errorType: error instanceof Error ? error.name : "unknown",
      })
    }
  }

  if (tally.processed || tally.failed || tally.retried) {
    logInfo("product_feedback.queue_drain", {
      processed: tally.processed,
      failed: tally.failed,
      retried: tally.retried,
      deferred: tally.deferred,
    })
  }
  return tally
}
