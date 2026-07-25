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
 * is below its target.
 *
 * WHO DRAINS THE QUEUE. On serverless there is no true background work after a
 * response, and the Vercel cron is on the Hobby plan (once a DAY — a backstop, not
 * a worker). So the drainers are, in order of preference:
 *   1. `POST /api/study/warm` — fired fire-and-forget by the client while the
 *      student is idle (picking a course, answering the current stage). This is
 *      the one that matters: it moves generation OFF the critical path.
 *   2. A serve request that found an EMPTY pool — the last-resort path that makes
 *      the student wait. Keep it, but it should rarely trigger.
 *   3. `/api/cron/process` — daily safety net.
 * Relying on 2 alone is what made the quiz sit at "90%" on every open: the bank
 * could never accumulate, because it only ever grew while someone was waiting.
 *
 * Dedupe: `JobRepository.enqueue` keys study jobs on `payload.dedupeKey`
 * (scope+quiz+difficulty) and `claimNext` is atomic (FOR UPDATE SKIP LOCKED), so
 * concurrent pollers never double-generate.
 */

import {
  StudyItemsRepository,
  type StudyScope,
  type NewStudyItem,
} from "../repositories/study-items.repo"
import { GraphRepository } from "../repositories/graph.repo"
import { CourseGraphRepository } from "../repositories/course-graph.repo"
import { ChunkRepository } from "../repositories/chunk.repo"
import { JobRepository, type DbJob } from "../repositories/job.repo"
import { topicKey } from "../repositories/mastery.repo"
import { buildEvidenceContextByTopics } from "../rag/retrieval/hybrid"
import { inquisitorAgent } from "../rag/agents/inquisitor"
import { matchingAgent } from "../rag/agents/matching"
import { verafalsoAgent } from "../rag/agents/verafalso"
import { orderingAgent } from "../rag/agents/ordering"
import { fillblankAgent } from "../rag/agents/fillblank"
import { gateQuiz } from "../rag/eval/gates"
import { embedTexts } from "@/lib/llm/embeddings"
import { logError, logInfo } from "@/lib/observability/logger"
import type { Difficulty, QuizQuestion } from "../rag/study-gen"
import type { SourceRefAPI } from "@/types/api"
import { flags } from "@/lib/config/flags"

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
// Alternative exercise kinds seeded into the same bank per run (AreaEstudio.dc).
// Small counts: the bank stays MC-dominant; the stage assembler applies the quota.
const CONEX_PER_BATCH = 2
const VF_PER_BATCH = 3
const ORDER_PER_BATCH = 2
const FILL_PER_BATCH = 2
// The alt kinds as stored in the payload, and the per-difficulty floor the
// mini-migration fills full banks up to. One alt-only batch yields up to 9 items
// (2+3+2+2), so 8 leaves headroom for a dedupe drop and still completes in one run.
export const ALT_KINDS = ["conex", "vf", "order", "fill"]
export const ALT_TARGET_PER_DIFFICULTY = 8

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
  /** Source/graph revision captured before generation starts. */
  contentFingerprint: string
  /**
   * Mini-migration mode: the quiz bank is already at target but was filled before
   * the redesign (all multiple-choice) — generate ONLY the alternative kinds
   * (conex/vf/order/fill) up to ALT_TARGET_PER_DIFFICULTY.
   */
  altOnly?: boolean
}

const dedupeKeyFor = (scope: StudyScope, difficulty: Difficulty, fingerprint = "") =>
  `${scope.kind}:${scope.id}:quiz:${difficulty}${fingerprint ? `:${fingerprint}` : ""}`

async function currentFingerprint(scope: StudyScope, ownerId?: string): Promise<string> {
  if (scope.kind === "doc") return ChunkRepository.contentFingerprint(scope.id)
  if (!ownerId) return ""
  return ChunkRepository.contentFingerprintByCourse(ownerId, scope.id)
}

/**
 * Build the evidence text (+ weighted topics) a generation batch is grounded on.
 * Doc scope prefers topic-focused retrieval, falling back to the concatenated
 * document; course scope uses the concatenated course text.
 * Exported for the exam service (recall/case generation grounds on the same evidence).
 */
export async function buildEvidence(
  scope: StudyScope,
  ownerId: string | undefined,
): Promise<{
  text: string
  weightedTopics: { label: string; weight: number }[]
  sourceRefs: SourceRefAPI[]
  coverage?: { covered: string[]; insufficient: string[]; absent: string[] }
} | null> {
  if (scope.kind === "doc") {
    const graph = await GraphRepository.getGraph(scope.id)
    const topicLabels = graph.topics.map((t) => t.label.trim()).filter(Boolean)
    const weightedTopics = graph.topics
      .filter((t) => (t.weight_percent ?? 0) > 0)
      .map((t) => ({ label: t.label, weight: Number(t.weight_percent) }))
    const retrieved = await buildEvidenceContextByTopics({ kind: "doc", id: scope.id }, topicLabels)
    const text = retrieved?.text ?? (await ChunkRepository.getConcatenatedText(scope.id))
    const sourceRefs =
      retrieved?.sourceRefs ?? graph.topics.flatMap((topic) => topic.source_refs ?? [])
    return text ? { text, weightedTopics, sourceRefs, coverage: retrieved?.coverage } : null
  }
  if (!ownerId) return null
  const [text, courseGraph] = await Promise.all([
    ChunkRepository.getConcatenatedTextByCourse(ownerId, scope.id),
    CourseGraphRepository.get(scope.id),
  ])
  const weightedTopics =
    courseGraph?.status === "ready"
      ? (courseGraph.data?.nodes ?? [])
          .filter((node) => node.label.trim() && node.weight_percent > 0)
          .map((node) => ({ label: node.label, weight: Number(node.weight_percent) }))
      : []
  const sourceRefs = courseGraph?.data?.nodes.flatMap((node) => node.source_refs ?? []) ?? []
  return text ? { text, weightedTopics, sourceRefs } : null
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
  altOnly = false,
  expectedFingerprint?: string,
): Promise<{ added: number; stale: boolean }> {
  const ev = await buildEvidence(scope, ownerId)
  if (!ev || ev.text.trim().length < 80) return { added: 0, stale: false }

  const excludeSeen = await StudyItemsRepository.listDedupeTexts(scope, "quiz")
  const genOpts = { difficulty, weightedTopics: ev.weightedTopics, excludeSeen, language }
  const perBatch = Math.ceil(GEN_BATCH / SUB_BATCHES)
  // MC questions go through the Critic gate; the alternative kinds (conex/vf/
  // order/fill) use their own schema-level validation (the MC critic doesn't
  // apply to them) and fail soft so a bad batch never blocks the MC fill.
  // `altOnly` (mini-migration for pre-redesign full banks) skips the MC chains.
  const [mcBatches, conex, vf, order, fill] = await Promise.all([
    altOnly
      ? Promise.resolve([] as QuizQuestion[][])
      : Promise.all(
          Array.from({ length: SUB_BATCHES }, () =>
            inquisitorAgent(ev.text, genOpts, perBatch).then((raw) => gateQuiz(raw, ev.text)),
          ),
        ),
    matchingAgent(ev.text, genOpts, CONEX_PER_BATCH).catch(() => [] as QuizQuestion[]),
    verafalsoAgent(ev.text, genOpts, VF_PER_BATCH).catch(() => [] as QuizQuestion[]),
    orderingAgent(ev.text, genOpts, ORDER_PER_BATCH).catch(() => [] as QuizQuestion[]),
    fillblankAgent(ev.text, genOpts, FILL_PER_BATCH).catch(() => [] as QuizQuestion[]),
  ])
  const refs = (ev.sourceRefs as SourceRefAPI[] | undefined)?.slice(0, 8) ?? []
  const all = [...mcBatches.flat(), ...conex, ...vf, ...order, ...fill]
    .map((question) => ({
      ...question,
      source_refs: question.source_refs?.length ? question.source_refs : refs,
    }))
    .filter((question) => !flags.studyPipelineV2 || (question.source_refs?.length ?? 0) > 0)
  if (all.length === 0) return { added: 0, stale: false }

  const embeddings = await embedTexts(all.map((q) => q.question))
  const items: NewStudyItem[] = all.map((q: QuizQuestion, i) => ({
    userId: null,
    type: "quiz",
    topicKey: q.topic ? topicKey(q.topic) : null,
    difficulty,
    payload: q,
    dedupeText: q.question,
    embedding: embeddings[i],
  }))
  if (expectedFingerprint) {
    const latest = await currentFingerprint(scope, ownerId)
    if (latest !== expectedFingerprint) return { added: 0, stale: true }
  }
  return { added: await StudyItemsRepository.insertDeduped(scope, items), stale: false }
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
    const contentFingerprint = await currentFingerprint(scope, ownerId)
    const dedupeKey = dedupeKeyFor(scope, difficulty, contentFingerprint)
    const payload: BankJobPayload = {
      scopeKind: scope.kind,
      scopeId: scope.id,
      difficulty,
      target,
      ownerId,
      language,
      dedupeKey,
      contentFingerprint,
    }
    if (total >= target) {
      // Mini-migration: the bank is full but may predate the redesign (all
      // multiple-choice). If it's short on alternative kinds, seed JUST those.
      const alt = await StudyItemsRepository.countByKinds(scope, difficulty, ALT_KINDS)
      if (alt >= ALT_TARGET_PER_DIFFICULTY) return
      payload.altOnly = true
    }
    await JobRepository.enqueue(JOB_TYPE_STUDY, payload as unknown as Record<string, unknown>, {
      dedupeKey: payload.dedupeKey,
    })
  },

  /** Is a fill job still pending/processing for (scope, difficulty)? Drives the UI's "generando" flag. */
  async hasPending(scope: StudyScope, difficulty: Difficulty, ownerId?: string): Promise<boolean> {
    const fingerprint = await currentFingerprint(scope, ownerId)
    return JobRepository.hasPending(JOB_TYPE_STUDY, dedupeKeyFor(scope, difficulty, fingerprint))
  },

  /**
   * Drain up to `max` study-bank jobs (default 1). Atomic claim → concurrent
   * callers won't double-generate.
   *
   * `target` scopes the claim to one (scope, difficulty). The serve path MUST pass
   * it: an unfiltered claim makes a student's request spend its whole invocation
   * generating some other scope's bank while their own stays empty and they keep
   * polling. The cron backstop drains unfiltered on purpose (it works the queue).
   */
  async drain(
    max = 1,
    target?: { scope: StudyScope; difficulty: Difficulty; ownerId?: string },
  ): Promise<{ processed: number; failed: number }> {
    const tally = { processed: 0, failed: 0 }
    const filter = target
      ? {
          dedupeKey: dedupeKeyFor(
            target.scope,
            target.difficulty,
            await currentFingerprint(target.scope, target.ownerId),
          ),
        }
      : undefined
    for (let i = 0; i < max; i++) {
      const job = await JobRepository.claimNext(JOB_TYPE_STUDY, 10, filter)
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
    const latestBefore = await currentFingerprint(scope, p.ownerId)
    if (p.contentFingerprint && latestBefore !== p.contentFingerprint) {
      await JobRepository.complete(job.id, { added: 0, reason: "stale-revision" })
      tally.processed++
      return
    }
    // Alt-only jobs (mini-migration) measure progress against the alt-kind floor,
    // not the full bank target — the bank is already at target by definition.
    const total = p.altOnly
      ? await StudyItemsRepository.countByKinds(scope, p.difficulty, ALT_KINDS)
      : await StudyItemsRepository.countByTypeDifficulty(scope, "quiz", p.difficulty)
    const goal = p.altOnly ? ALT_TARGET_PER_DIFFICULTY : target
    if (total >= goal) {
      await JobRepository.complete(job.id, {
        added: 0,
        total,
        reason: p.altOnly ? "at-alt-target" : "at-target",
      })
      tally.processed++
      return
    }
    const generated = await generateQuizBatch(
      scope,
      p.difficulty,
      p.ownerId,
      p.language,
      p.altOnly,
      p.contentFingerprint,
    )
    if (generated.stale) {
      await JobRepository.complete(job.id, { added: 0, reason: "stale-revision" })
      tally.processed++
      return
    }
    const added = generated.added
    const newTotal = total + added
    await JobRepository.complete(job.id, { added, total: newTotal, altOnly: p.altOnly ?? false })
    tally.processed++
    // Keep filling while below target — but only if this run made progress, else
    // the material is exhausted and re-enqueuing would loop forever.
    if (added > 0 && newTotal < goal) {
      await JobRepository.enqueue(JOB_TYPE_STUDY, job.payload, { dedupeKey: p.dedupeKey })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const { retried } = await JobRepository.fail(job.id, msg)
    if (!retried) tally.failed++
    logError("study.bank.job_failed", { scopeId: p.scopeId, difficulty: p.difficulty, error: msg })
  }
}
