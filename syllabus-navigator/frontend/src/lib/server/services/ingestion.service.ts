/**
 * server/services/ingestion.service.ts — async RAG worker pipeline.
 *
 * Phase 1 (text extraction + chunking) runs synchronously in the upload request
 * (see document.service.ts). This worker runs phase 2 from a `jobs` row:
 *   embed chunks → status 'processed' → generate graph → graph_status 'ready'.
 *
 * Port of the embedding/graph parts of backend/app/services/ingestor.py.
 */

import { embedTexts } from "@/lib/llm/embeddings"
import { isTransientLLMError } from "@/lib/llm/rag-generate"
import { ChunkRepository } from "../repositories/chunk.repo"
import { GraphRepository } from "../repositories/graph.repo"
import { ScheduleRepository } from "../repositories/schedule.repo"
import { DocumentRepository } from "../repositories/document.repo"
import { JobRepository } from "../repositories/job.repo"
import { extractGraphFromText } from "../rag/graph-gen"
import { extractScheduleFromText } from "../rag/schedule-gen"
import { CourseService } from "./course.service"
import { logError, logInfo } from "@/lib/observability/logger"

const JOB_TYPE = "ingest"

export const IngestionService = {
  /** Process one ingestion job (idempotent: re-running re-embeds pending chunks). */
  async runIngestJob(
    syllabusId: string,
  ): Promise<{ embedded: number; topics: number; events: number }> {
    let embedded = 0
    let topics = 0
    let events = 0

    // --- Embeddings ---
    try {
      const pending = await ChunkRepository.listPendingEmbeddings(syllabusId)
      if (pending.length > 0) {
        const vectors = await embedTexts(pending.map((c) => c.content))
        // Hard invariant: one vector per chunk, in order. A mismatch means the
        // embedding/chunk alignment is broken — fail loudly rather than persist
        // vectors against the wrong chunks (which would silently corrupt retrieval).
        if (vectors.length !== pending.length) {
          throw new Error(
            `Embedding count mismatch: ${vectors.length} vectors for ${pending.length} chunks`,
          )
        }
        await ChunkRepository.setEmbeddings(
          pending.map((c, i) => ({ id: c.id, embedding: vectors[i] })),
        )
        embedded = pending.length
      }
      await DocumentRepository.setStatus(syllabusId, "processed")
      logInfo("ingestion.embedded", { syllabusId, embedded })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await DocumentRepository.setStatus(syllabusId, "error", msg.slice(0, 2000))
      logError("ingestion.embed_failed", { syllabusId, error: msg })
      throw err // graph won't run if embeddings failed
    }

    // Concatenated text is reused by graph, schedule and course inference.
    const text = await ChunkRepository.getConcatenatedText(syllabusId)

    // --- Course inference (best-effort; accounts only, skips guests internally) ---
    // Runs before graph/schedule so a slow LLM there can't starve the suggestion.
    try {
      await CourseService.inferForDocument(syllabusId, text)
    } catch (err) {
      logError("ingestion.course_infer_failed", {
        syllabusId,
        error: err instanceof Error ? err.message : String(err),
      })
    }

    // Transient LLM failures (gateway 429/5xx) below are rethrown AFTER both
    // steps ran, so the job retries with backoff instead of "completing" with a
    // permanently-failed graph. Permanent failures stay best-effort.
    let transient: string | null = null

    // --- Graph generation (best-effort: a failure here doesn't fail the upload) ---
    try {
      await DocumentRepository.setGraphStatus(syllabusId, "processing")
      const nodes = await extractGraphFromText(text)
      await GraphRepository.replaceGraph(syllabusId, nodes)
      await DocumentRepository.setGraphStatus(syllabusId, "ready")
      topics = nodes.length
      logInfo("ingestion.graph_ready", { syllabusId, topics })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await DocumentRepository.setGraphStatus(syllabusId, "failed", msg.slice(0, 2000))
      logError("ingestion.graph_failed", { syllabusId, error: msg })
      if (isTransientLLMError(err)) transient = `graph: ${msg}`
    }

    // --- Schedule extraction (best-effort; independent of the graph) ---
    try {
      const extracted = await extractScheduleFromText(text)
      events = await ScheduleRepository.replaceEvents(syllabusId, extracted)
      logInfo("ingestion.schedule_ready", { syllabusId, events })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logError("ingestion.schedule_failed", { syllabusId, error: msg })
      if (isTransientLLMError(err)) transient = transient ?? `schedule: ${msg}`
    }

    // Retryable failure → let drainQueue re-queue the job (embeddings are
    // idempotent, so the retry goes straight to the failed generator).
    if (transient) throw new Error(`Transient enrichment failure — will retry (${transient})`)

    return { embedded, topics, events }
  },

  /**
   * Phase 2a (fast): embed pending chunks and mark the doc 'processed' so it's
   * chat-ready and visible immediately. Does NOT run graph/schedule/inference —
   * those slow (gpt-5.4) generators run separately so the upload request returns
   * quickly instead of blocking ~35s+ and timing out (which dropped the row).
   */
  async embedOnly(syllabusId: string): Promise<{ embedded: number }> {
    try {
      const pending = await ChunkRepository.listPendingEmbeddings(syllabusId)
      let embedded = 0
      if (pending.length > 0) {
        const vectors = await embedTexts(pending.map((c) => c.content))
        if (vectors.length !== pending.length) {
          throw new Error(
            `Embedding count mismatch: ${vectors.length} vectors for ${pending.length} chunks`,
          )
        }
        await ChunkRepository.setEmbeddings(
          pending.map((c, i) => ({ id: c.id, embedding: vectors[i] })),
        )
        embedded = pending.length
      }
      await DocumentRepository.setStatus(syllabusId, "processed")
      logInfo("ingestion.embedded", { syllabusId, embedded })
      return { embedded }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await DocumentRepository.setStatus(syllabusId, "error", msg.slice(0, 2000))
      logError("ingestion.embed_failed", { syllabusId, error: msg })
      throw err
    }
  },

  /**
   * Claim and process pending ingest jobs until the queue is empty or maxJobs is
   * reached. Called by the cron/process route (Vercel Cron + fire-and-forget
   * trigger from upload). Job claiming is atomic, so concurrent runs are safe.
   */
  async drainQueue(maxJobs = 5): Promise<{ processed: number; failed: number; retried: number }> {
    const tally = { processed: 0, failed: 0, retried: 0 }

    for (let i = 0; i < maxJobs; i++) {
      const job = await JobRepository.claimNext(JOB_TYPE)
      if (!job) break
      await processClaimedJob(job, tally)
    }

    if (tally.processed || tally.failed || tally.retried) logInfo("ingestion.drain", tally)
    return tally
  },

  /**
   * Drain only the job for one syllabus (user-initiated reprocess). Claims at
   * most one job so the reprocess route fits in its maxDuration; the rest of
   * the queue is drained by the cron backstop and post-upload triggers.
   */
  async drainForSyllabus(
    syllabusId: string,
  ): Promise<{ processed: number; failed: number; retried: number }> {
    const tally = { processed: 0, failed: 0, retried: 0 }

    const job = await JobRepository.claimNext(JOB_TYPE, 10, syllabusId)
    if (job) await processClaimedJob(job, tally)

    if (tally.processed || tally.failed || tally.retried)
      logInfo("ingestion.drain_targeted", { syllabusId, ...tally })
    return tally
  },
}

/** Run one claimed job through the pipeline and settle it (complete/fail). */
async function processClaimedJob(
  job: { id: string; payload: Record<string, unknown> },
  tally: { processed: number; failed: number; retried: number },
): Promise<void> {
  const syllabusId = (job.payload as { syllabusId?: string }).syllabusId
  if (!syllabusId) {
    // Unrecoverable payload error — don't waste retries on it.
    await JobRepository.fail(job.id, "Missing syllabusId in payload", true)
    tally.failed++
    return
  }

  try {
    const result = await IngestionService.runIngestJob(syllabusId)
    await JobRepository.complete(job.id, result)
    tally.processed++
  } catch (err) {
    const { retried: willRetry } = await JobRepository.fail(
      job.id,
      err instanceof Error ? err.message : String(err),
    )
    if (willRetry) tally.retried++
    else tally.failed++
  }
}
