/**
 * server/services/study-bank.service.ts — background generator for the staged
 * quiz item bank.
 *
 * The problem this solves: quiz questions used to be generated INLINE inside the
 * serve request (`getQuizStage`), so a cold bank blocked the UI for seconds and,
 * once the per-difficulty cap was hit, generation stopped and the quiz got stuck
 * with nothing new to serve.
 *
 * Here generation is a `jobs` row (`type = "study-bank"`) instead. Each job run
 * generates ONE batch (~GEN_BATCH questions) and re-enqueues itself while the bank
 * is below its target — so the bank fills across several short requests rather than
 * one long one. On serverless (Vercel) we can't run true background work after the
 * response, so the queue is drained a little on every serve/poll (`drain(1)`): the
 * client polling the quiz stage is what advances generation, with the cron backstop
 * (`/api/cron/process`) filling in when nobody is polling.
 *
 * Dedupe: `JobRepository.enqueue` keys study jobs on `payload.dedupeKey`
 * (scope+quiz+difficulty) and `claimNext` is atomic (FOR UPDATE SKIP LOCKED), so
 * concurrent pollers never double-generate.
 */

import { StudyItemsRepository, type StudyScope, type NewStudyItem } from "../repositories/study-items.repo"
import { GraphRepository } from "../repositories/graph.repo"
import { ChunkRepository } from "../repositories/chunk.repo"
import { JobRepository, type DbJob } from "../repositories/job.repo"
import { topicKey } from "../repositories/mastery.repo"
import { buildContextByTopics } from "../rag/retrieval/hybrid"
import { inquisitorAgent } from "../rag/agents/inquisitor"
import { gateQuiz } from "../rag/eval/gates"
import { embedTexts } from "@/lib/llm/embeddings"
import { logError, logInfo } from "@/lib/observability/logger"
import type { Difficulty, QuizQuestion } from "../rag/study-gen"

export const JOB_TYPE_STUDY = "study-bank"

// Target distinct quiz items PER DIFFICULTY per scope. The bank fills to this in
// the background; once reached, the staged quiz recycles seen items (see
// study.service). Per-difficulty so a `medio`-heavy bank never starves `dificil`.
export const BANK_TARGET_PER_DIFFICULTY = 70
// Questions requested per job run (the gate + embedding dedupe drop some).
const GEN_BATCH = 18
// Split each run into parallel gen→gate chains so one batch ≈ 1/SUB_BATCHES of a
// single 18-item call. Sub-batches share `excludeSeen`; insertDeduped drops any
// near-duplicates between them at persist time.
const SUB_BATCHES = 3

interface BankJobPayload {
  scopeKind: "doc" | "course"
  scopeId: string
  difficulty: Difficulty
  target: number
  /** Owner id — needed to assemble whole-course evidence. */
  ownerId?: string
  /** Output language for generated questions. */
  language?: string
  /** Dedupe key so enqueue collapses duplicate jobs for the same scope+difficulty. */
  dedupeKey: string
}

const dedupeKeyFor = (scope: StudyScope, difficulty: Difficulty) =>
  `${scope.kind}:${scope.id}:quiz:${difficulty}`

/**
 * Build the evidence text (+ weighted topics) a generation batch is grounded on.
 * Doc scope prefers topic-focused retrieval, falling back to the concatenated
 * document; course scope uses the concatenated course text.
 */
async function buildEvidence(
  scope: StudyScope,
  ownerId: string | undefined,
): Promise<{ text: string; weightedTopics: { label: string; weight: number }[] } | null> {
  if (scope.kind === "doc") {
    const graph = await GraphRepository.getGraph(scope.id)
    const topicLabels = graph.topics.map((t) => t.label.trim()).filter(Boolean)
    const weightedTopics = graph.topics
      .filter((t) => (t.weight_percent ?? 0) > 0)
      .map((t) => ({ label: t.label, weight: Number(t.weight_percent) }))
    const text =
      (await buildContextByTopics({ kind: "doc", id: scope.id }, topicLabels)) ??
      (await ChunkRepository.getConcatenatedText(scope.id))
    return text ? { text, weightedTopics } : null
  }
  if (!ownerId) return null
  const text = await ChunkRepository.getConcatenatedTextByCourse(ownerId, scope.id)
  return text ? { text, weightedTopics: [] } : null
}

/**
 * Generate ONE batch of quiz items at `difficulty` and persist the novel ones.
 * Returns how many were actually added (0 when the material can't yield anything
 * new — the caller uses that to stop re-enqueuing).
 */
async function generateQuizBatch(
  scope: StudyScope,
  difficulty: Difficulty,
  ownerId: string | undefined,
  language: string | undefined,
): Promise<number> {
  const ev = await buildEvidence(scope, ownerId)
  if (!ev || ev.text.trim().length < 80) return 0

  const excludeSeen = await StudyItemsRepository.listDedupeTexts(scope, "quiz")
  const perBatch = Math.ceil(GEN_BATCH / SUB_BATCHES)
  const batches = await Promise.all(
    Array.from({ length: SUB_BATCHES }, () =>
      inquisitorAgent(
        ev.text,
        { difficulty, weightedTopics: ev.weightedTopics, excludeSeen, language },
        perBatch,
      ).then((raw) => gateQuiz(raw, ev.text)),
    ),
  )
  const gated = batches.flat()
  if (gated.length === 0) return 0

  const embeddings = await embedTexts(gated.map((q) => q.question))
  const items: NewStudyItem[] = gated.map((q: QuizQuestion, i) => ({
    userId: null,
    type: "quiz",
    topicKey: q.topic ? topicKey(q.topic) : null,
    difficulty,
    payload: q,
    dedupeText: q.question,
    embedding: embeddings[i],
  }))
  return StudyItemsRepository.insertDeduped(scope, items)
}

export const StudyBankService = {
  BANK_TARGET_PER_DIFFICULTY,

  /**
   * Ensure a background fill job exists for (scope, difficulty) when the bank is
   * below target. No-op when already at target or a job is already queued (dedupe).
   */
  async ensure(
    scope: StudyScope,
    difficulty: Difficulty,
    ownerId?: string,
    language?: string,
    target = BANK_TARGET_PER_DIFFICULTY,
  ): Promise<void> {
    const total = await StudyItemsRepository.countByTypeDifficulty(scope, "quiz", difficulty)
    if (total >= target) return
    const payload: BankJobPayload = {
      scopeKind: scope.kind,
      scopeId: scope.id,
      difficulty,
      target,
      ownerId,
      language,
      dedupeKey: dedupeKeyFor(scope, difficulty),
    }
    await JobRepository.enqueue(JOB_TYPE_STUDY, payload as unknown as Record<string, unknown>, {
      dedupeKey: payload.dedupeKey,
    })
  },

  /** Is a fill job still pending/processing for (scope, difficulty)? Drives the UI's "generando" flag. */
  async hasPending(scope: StudyScope, difficulty: Difficulty): Promise<boolean> {
    return JobRepository.hasPending(JOB_TYPE_STUDY, dedupeKeyFor(scope, difficulty))
  },

  /**
   * Drain up to `max` study-bank jobs (default 1). Called from the serve/poll path
   * so each request advances generation a little. Atomic claim → concurrent callers
   * won't double-generate.
   */
  async drain(max = 1): Promise<{ processed: number; failed: number }> {
    const tally = { processed: 0, failed: 0 }
    for (let i = 0; i < max; i++) {
      const job = await JobRepository.claimNext(JOB_TYPE_STUDY)
      if (!job) break
      await processBankJob(job, tally)
    }
    if (tally.processed || tally.failed) logInfo("study.bank.drain", tally)
    return tally
  },
}

/** Run one claimed fill job: generate a batch, settle it, re-enqueue if still short. */
async function processBankJob(
  job: DbJob,
  tally: { processed: number; failed: number },
): Promise<void> {
  const p = job.payload as unknown as BankJobPayload
  if (!p.scopeId || !p.difficulty) {
    await JobRepository.fail(job.id, "Missing scope/difficulty in study-bank payload", true)
    tally.failed++
    return
  }
  const scope: StudyScope = { kind: p.scopeKind, id: p.scopeId }
  const target = p.target ?? BANK_TARGET_PER_DIFFICULTY

  try {
    const total = await StudyItemsRepository.countByTypeDifficulty(scope, "quiz", p.difficulty)
    if (total >= target) {
      await JobRepository.complete(job.id, { added: 0, total, reason: "at-target" })
      tally.processed++
      return
    }
    const added = await generateQuizBatch(scope, p.difficulty, p.ownerId, p.language)
    const newTotal = total + added
    await JobRepository.complete(job.id, { added, total: newTotal })
    tally.processed++
    // Keep filling while below target — but only if this run made progress, else
    // the material is exhausted and re-enqueuing would loop forever.
    if (added > 0 && newTotal < target) {
      await JobRepository.enqueue(JOB_TYPE_STUDY, job.payload, { dedupeKey: p.dedupeKey })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const { retried } = await JobRepository.fail(job.id, msg)
    if (!retried) tally.failed++
    logError("study.bank.job_failed", { scopeId: p.scopeId, difficulty: p.difficulty, error: msg })
  }
}
