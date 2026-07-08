/**
 * StudyService — serve per-course study material for the "Área de Estudio" window.
 *
 * Step 1 of the Study Engine rework (anti-repeat):
 *  - versioned cache: a cached set is only reused when the content fingerprint AND
 *    schema version still match (re-upload / schema bump invalidates it),
 *  - persistent item bank: each generation feeds the already-seen items back as
 *    `excludeSeen` and persists genuinely new items (deduped by embedding), so a
 *    refresh ADDS new material instead of regenerating near-identical items,
 *  - the UI still receives a plain StudySet (bundle), now assembled from the
 *    growing bank for the default scope.
 *
 * Ownership is enforced via DocumentRepository.findByIdAndUser (same as GraphService).
 */

import { DocumentRepository } from "../repositories/document.repo"
import { ChunkRepository } from "../repositories/chunk.repo"
import { StudyRepository } from "../repositories/study.repo"
import { StudyStatsRepository } from "../repositories/study-stats.repo"
import { GraphRepository } from "../repositories/graph.repo"
import { CourseRepository } from "../repositories/course.repo"
import { MasteryRepository, topicKey } from "../repositories/mastery.repo"
import {
  StudyItemsRepository,
  type StudyScope,
  type NewStudyItem,
} from "../repositories/study-items.repo"
import { QuizReviewRepository, type ReviewQuestion } from "../repositories/quiz-review.repo"
import { QuizSeenRepository } from "../repositories/quiz-seen.repo"
import { ApiErrorResponse } from "../utils/auth-helpers"
import { buildContextByTopics } from "../rag/retrieval/hybrid"
import { webSearchContext, appendWebContext } from "../rag/web-search"
import { orchestrateStudySet } from "../rag/orchestrator/runner"
import { inquisitorAgent } from "../rag/agents/inquisitor"
import { gateQuiz } from "../rag/eval/gates"
import { buildStudyPlan, orderLabelsByPlan } from "../rag/orchestrator/router"
import { embedTexts } from "@/lib/llm/embeddings"
import { logError } from "@/lib/observability/logger"
import {
  STUDY_SCHEMA_VERSION,
  shuffleQuizOptions,
  pickMindMode,
  type StudySet,
  type Difficulty,
  type Flashcard,
  type QuizQuestion,
  type MindMode,
} from "../rag/study-gen"

/** Serve-time option shuffle for a whole set's quiz (bank items have biased `answer`). */
function shuffleSetQuiz(set: StudySet): StudySet {
  if (set.quiz.length === 0) return set
  return { ...set, quiz: set.quiz.map((q) => shuffleQuizOptions(q)) }
}

// How many bank items to surface in an assembled default set (keeps UI counts sane).
const SET_FLASHCARDS = 14
const SET_QUIZ = 20

// ── Staged quiz (3 escalating stages of 15) ──────────────────────────────────
export const STAGE_SIZE = 15 // questions a student must clear per stage
const STAGE_POOL = 20 // served per stage (15 + buffer so wrong answers can be swapped)
const STAGES = 3
// Max quiz items generated per scope PER DIFFICULTY (anti-runaway). Per-difficulty
// so a bank full of `medio` never starves the `dificil` bucket; 40×3 difficulties
// = up to 120 distinct questions per scope.
const BANK_CAP_PER_DIFFICULTY = 40
const GEN_BATCH = 18 // questions requested per lazy generation (gate drops some)
// Generation is split into parallel sub-batches (each gen→gate chain runs
// independently) so cold wall-clock ≈ 1/SUB_BATCHES of a single 18-item call.
// Sub-batches share `excludeSeen`, so near-duplicates BETWEEN them are possible —
// acceptable: insertDeduped drops them by embedding at persist time.
const SUB_BATCHES = 3
const DIFFICULTY_LADDER: Difficulty[] = ["facil", "medio", "dificil"]

/** A staged-quiz question carries its bank id so the client can exclude served items. */
export interface StageQuestion extends QuizQuestion {
  id: string
}
export interface QuizStage {
  stage: number
  stages: number
  difficulty: Difficulty
  questions: StageQuestion[]
}

/**
 * Hybrid escalation (mastery + score): mastery sets the base rung, the stage index
 * climbs the ladder, and the client-supplied `boost` (earned by acing prior stages)
 * accelerates it. Never drops below the base — failing a stage doesn't punish.
 * Floor is `medio` (idx 1): the quiz always starts from medium and climbs — strong
 * mastery starts at difícil. Difficulty is fully automatic; there's no manual picker.
 */
function stageDifficulty(stage: number, masteryAvg: number, boost: number): Difficulty {
  const base = masteryAvg >= 0.6 ? 2 : 1
  const idx = Math.min(DIFFICULTY_LADDER.length - 1, Math.max(1, base + stage + boost))
  return DIFFICULTY_LADDER[idx]
}

/** Order bank items by the plan's topic priority (weak/urgent/heavy first); recency otherwise. */
function orderByPlan<T extends { topicKey: string | null }>(
  items: T[],
  orderedKeys: string[],
): T[] {
  if (orderedKeys.length === 0) return items
  const rank = new Map(orderedKeys.map((k, i) => [k, i]))
  return [...items].sort((a, b) => {
    const ra = a.topicKey != null ? (rank.get(a.topicKey) ?? Infinity) : Infinity
    const rb = b.topicKey != null ? (rank.get(b.topicKey) ?? Infinity) : Infinity
    return ra - rb
  })
}

/**
 * Ensure the bank holds enough quiz items at `difficulty` for a stage; generate a
 * gated batch lazily when short (respecting the per-scope cap), then return the
 * pool (excluding already-served ids). `genEvidence` is only invoked when we must
 * generate, so a warm bank costs no LLM call.
 */
async function stageItems(
  scope: StudyScope,
  difficulty: Difficulty,
  excludeIds: string[],
  genEvidence: () => Promise<{
    text: string
    weightedTopics: { label: string; weight: number }[]
  } | null>,
): Promise<{ id: string; topicKey: string | null; payload: QuizQuestion }[]> {
  let pool = await StudyItemsRepository.listForStage<QuizQuestion>(
    scope,
    "quiz",
    difficulty,
    STAGE_POOL,
    excludeIds,
  )
  if (pool.length < STAGE_SIZE) {
    const total = await StudyItemsRepository.countByTypeDifficulty(scope, "quiz", difficulty)
    if (total < BANK_CAP_PER_DIFFICULTY) {
      try {
        const ev = await genEvidence()
        if (ev && ev.text.trim().length >= 80) {
          const excludeSeen = await StudyItemsRepository.listDedupeTexts(scope, "quiz")
          const perBatch = Math.ceil(GEN_BATCH / SUB_BATCHES)
          const batches = await Promise.all(
            Array.from({ length: SUB_BATCHES }, () =>
              inquisitorAgent(
                ev.text,
                { difficulty, weightedTopics: ev.weightedTopics, excludeSeen },
                perBatch,
              ).then((raw) => gateQuiz(raw, ev.text)),
            ),
          )
          const gated = batches.flat()
          if (gated.length > 0) {
            const embeddings = await embedTexts(gated.map((q) => q.question))
            const items: NewStudyItem[] = gated.map((q, i) => ({
              userId: null,
              type: "quiz",
              topicKey: q.topic ? topicKey(q.topic) : null,
              difficulty,
              payload: q,
              dedupeText: q.question,
              embedding: embeddings[i],
            }))
            await StudyItemsRepository.insertDeduped(scope, items)
            pool = await StudyItemsRepository.listForStage<QuizQuestion>(
              scope,
              "quiz",
              difficulty,
              STAGE_POOL,
              excludeIds,
            )
          }
        }
      } catch (err) {
        logError("study.stage.gen_error", {
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }
  return pool.map((p) => ({ id: p.id, topicKey: p.topicKey, payload: p.payload }))
}

/** Flatten a generated set into bank items (dedupe text + payload + topic). Pure. */
function decompose(
  set: StudySet,
): { dedupeText: string; type: "flashcard" | "quiz"; topicKey: string | null; payload: unknown }[] {
  const out: {
    dedupeText: string
    type: "flashcard" | "quiz"
    topicKey: string | null
    payload: unknown
  }[] = []
  for (const f of set.flashcards)
    out.push({ dedupeText: f.front, type: "flashcard", topicKey: null, payload: f })
  for (const q of set.quiz) {
    out.push({
      dedupeText: q.question,
      type: "quiz",
      topicKey: q.topic ? topicKey(q.topic) : null,
      payload: q,
    })
  }
  return out
}

/** Texts already in the bank for a scope → excludeSeen for the next generation. */
async function seenTexts(scope: StudyScope): Promise<string[]> {
  const [fronts, questions] = await Promise.all([
    StudyItemsRepository.listDedupeTexts(scope, "flashcard"),
    StudyItemsRepository.listDedupeTexts(scope, "quiz"),
  ])
  return [...fronts, ...questions]
}

/**
 * Persist the freshly generated items to the bank (embedded + deduped), then for
 * the default scope return a set assembled from the growing bank. Best-effort:
 * if embedding/persistence fails, fall back to serving the fresh set as-is.
 *
 * `orderedKeys` (the Router's topic priority order, weak/urgent/heavy first) is
 * used to rank the assembled quiz so the served set reflects the plan — without
 * it the bank would surface items by recency only, discarding the router's work.
 */
async function bankAndAssemble(
  scope: StudyScope,
  set: StudySet,
  difficulty: Difficulty,
  custom: boolean,
  orderedKeys: string[] = [],
): Promise<StudySet> {
  try {
    const items = decompose(set)
    if (items.length > 0) {
      const embeddings = await embedTexts(items.map((i) => i.dedupeText))
      const toInsert: NewStudyItem[] = items.map((it, i) => ({
        userId: null, // shared per scope for now (avoids guest FK; bank is sharable)
        type: it.type,
        topicKey: it.topicKey,
        difficulty,
        payload: it.payload,
        dedupeText: it.dedupeText,
        embedding: embeddings[i],
      }))
      await StudyItemsRepository.insertDeduped(scope, toInsert)
    }

    // Custom (topic/difficulty) sets stay focused — serve fresh, don't dilute with
    // the generic bank. Default sets are assembled from the accumulating bank.
    if (custom) return shuffleSetQuiz(set)

    // Pull a wider window than we serve, then rank by the plan so the surfaced
    // items are the highest-priority ones (not merely the most recent).
    const [bankFlash, bankQuiz] = await Promise.all([
      StudyItemsRepository.listRecent<Flashcard>(scope, "flashcard", SET_FLASHCARDS * 2),
      StudyItemsRepository.listRecent<QuizQuestion>(scope, "quiz", SET_QUIZ * 2),
    ])
    const rank = new Map(orderedKeys.map((k, i) => [k, i]))
    const byPlan = (a: { topicKey: string | null }, b: { topicKey: string | null }) => {
      const ra = a.topicKey != null ? (rank.get(a.topicKey) ?? Infinity) : Infinity
      const rb = b.topicKey != null ? (rank.get(b.topicKey) ?? Infinity) : Infinity
      return ra - rb // lower plan index = higher priority = first
    }
    const orderedQuiz = rank.size > 0 ? [...bankQuiz].sort(byPlan) : bankQuiz
    return shuffleSetQuiz({
      ...set,
      flashcards:
        bankFlash.length > 0
          ? bankFlash.slice(0, SET_FLASHCARDS).map((b) => b.payload)
          : set.flashcards,
      quiz:
        orderedQuiz.length > 0 ? orderedQuiz.slice(0, SET_QUIZ).map((b) => b.payload) : set.quiz,
    })
  } catch (err) {
    logError("study.bank.error", { error: err instanceof Error ? err.message : String(err) })
    return shuffleSetQuiz(set) // banking failed → still serve the freshly generated set
  }
}

/** Verify the caller owns the doc/course behind a scope; returns the scope or throws 404. */
async function assertScopeOwned(userId: string, scope: StudyScope): Promise<StudyScope> {
  if (scope.kind === "doc") {
    const doc = await DocumentRepository.findByIdAndUser(scope.id, userId)
    if (!doc) throw new ApiErrorResponse("Syllabus not found", 404)
    return scope
  }
  const course = await CourseRepository.findByIdAndUser(scope.id, userId)
  if (!course) throw new ApiErrorResponse("Course not found", 404)
  return scope
}

export const StudyService = {
  /**
   * Get the study set for a syllabus the caller owns.
   * - default (medio, whole-course) set is cached in `study_sets` (versioned),
   * - custom set (non-medio difficulty OR a specific topic) is generated fresh
   *   and NOT cached, so it never clobbers the default,
   * - 404 when the syllabus is not owned,
   * - 409 ("not ready") when the syllabus has no usable material yet.
   */
  async getStudySet(
    userId: string,
    syllabusId: string,
    opts: {
      refresh?: boolean
      difficulty?: Difficulty
      topic?: string
      web?: boolean
      /** Explicit mind-map mode override (from the edit drawer). Auto-picked when omitted. */
      mindMode?: MindMode
    } = {},
  ): Promise<StudySet> {
    const doc = await DocumentRepository.findByIdAndUser(syllabusId, userId)
    if (!doc) throw new ApiErrorResponse("Syllabus not found", 404)

    const topic = opts.topic?.trim() || undefined
    const difficulty = opts.difficulty ?? "medio"
    // Web-augmented sets pull live external context → always fresh, never cached
    // (so they can't clobber the canonical doc-only default set). An explicit mind
    // mode override is likewise a one-off request, not the canonical default.
    const custom = !!topic || difficulty !== "medio" || !!opts.web || !!opts.mindMode
    const scope: StudyScope = { kind: "doc", id: syllabusId }
    const fingerprint = await ChunkRepository.contentFingerprint(syllabusId)

    // Default set is cacheable; custom (topic/difficulty) sets are always fresh.
    // Cached quiz items carry the generator's position-biased `answer` → shuffle on serve.
    if (!opts.refresh && !custom) {
      const cached = await StudyRepository.get(syllabusId, fingerprint, STUDY_SCHEMA_VERSION)
      if (cached) return shuffleSetQuiz(cached)
    }

    // Bias generation toward the course's heaviest (most exam-weighted) topics.
    const { topics } = await GraphRepository.getGraph(syllabusId)
    const weightedTopics = topics
      .filter((t) => (t.weight_percent ?? 0) > 0)
      .map((t) => ({ label: t.label, weight: Number(t.weight_percent) }))

    // Step 5: the Router orders topics by student state (mastery gaps × exam
    // weight × schedule urgency × SRS pressure) so weak/urgent topics are studied
    // first. Degrades to graph order on any failure (guest, no signals).
    const plan = await buildStudyPlan(userId, syllabusId, weightedTopics, difficulty)
    const planLabels = orderLabelsByPlan(plan)
    const topicLabels = topics.map((t) => t.label.trim()).filter(Boolean)
    const ordered = planLabels.length > 0 ? planLabels : topicLabels

    // Step 2: retrieve material PER topic (hybrid dense+lexical) so the whole
    // syllabus is covered, not just the first 24k chars. A focus topic, if given,
    // leads the retrieval. Falls back to the full concatenated text.
    const labels = topic ? [topic, ...ordered] : ordered
    let text =
      (await buildContextByTopics({ kind: "doc", id: syllabusId }, labels)) ??
      (await ChunkRepository.getConcatenatedText(syllabusId))
    if (!text || text.trim().length < 80) {
      throw new ApiErrorResponse(
        "This course doesn't have enough indexed material yet. Try again once processing finishes.",
        409,
      )
    }

    // Web augmentation: run a live web search (focus topic, else the document's
    // subject) and append the grounded notes as supplementary source material.
    if (opts.web) {
      const query = topic ?? doc.original_filename.replace(/\.pdf$/i, "")
      const web = await webSearchContext(query)
      if (web) text = appendWebContext(text, web)
    }

    // Step 3+4: specialized agents (flashcard/inquisitor/synth/mindmap) + answer-
    // correctness gate, instead of one mega-call. Mind-map mode: an explicit
    // override wins, else a heuristic picks the presentation that best fits this
    // scope's content (see pickMindMode).
    const mindMode = opts.mindMode ?? pickMindMode({ topic, weightedTopics })
    const excludeSeen = await seenTexts(scope)
    const set = await orchestrateStudySet(
      text,
      { difficulty, topic, weightedTopics, excludeSeen, mindMode },
      { quiz: false }, // quiz is served by the staged endpoint, not the menu set
    )
    if (!set) {
      throw new ApiErrorResponse("Could not generate study material from this course.", 409)
    }

    // Reconnect the Router → served set: rank the assembled quiz by plan priority.
    const orderedKeys = plan.targets.map((t) => t.topicKey)
    const served = await bankAndAssemble(scope, set, difficulty, custom, orderedKeys)

    // Only persist the canonical default set.
    if (!custom) await StudyRepository.upsert(syllabusId, served, fingerprint, STUDY_SCHEMA_VERSION)
    return served
  },

  /**
   * Whole-course study set: aggregates the chunks of EVERY PDF in a course the
   * caller owns into a single set (cross-document questions). Same cache rules as
   * getStudySet, but keyed by course in course_study_sets.
   * - 404 when the course is not owned,
   * - 409 ("not ready") when the course has no indexed material yet.
   */
  async getCourseStudySet(
    userId: string,
    courseId: string,
    opts: {
      refresh?: boolean
      difficulty?: Difficulty
      topic?: string
      web?: boolean
      mindMode?: MindMode
    } = {},
  ): Promise<StudySet> {
    const course = await CourseRepository.findByIdAndUser(courseId, userId)
    if (!course) throw new ApiErrorResponse("Course not found", 404)

    const topic = opts.topic?.trim() || undefined
    const difficulty = opts.difficulty ?? "medio"
    // Web-augmented sets are always fresh (see getStudySet).
    const custom = !!topic || difficulty !== "medio" || !!opts.web || !!opts.mindMode
    const scope: StudyScope = { kind: "course", id: courseId }
    const fingerprint = await ChunkRepository.contentFingerprintByCourse(userId, courseId)

    if (!opts.refresh && !custom) {
      const cached = await StudyRepository.getByCourse(courseId, fingerprint, STUDY_SCHEMA_VERSION)
      if (cached) return shuffleSetQuiz(cached)
    }

    // Step 2: when a focus topic is given, retrieve it across the whole course
    // (hybrid). Otherwise use the full concatenated text (no course-level topic
    // graph yet — see rag-report §8.5).
    const focusLabels = topic ? [topic] : []
    let text =
      (await buildContextByTopics({ kind: "course", id: courseId, userId }, focusLabels)) ??
      (await ChunkRepository.getConcatenatedTextByCourse(userId, courseId))
    if (!text || text.trim().length < 80) {
      throw new ApiErrorResponse(
        "This course doesn't have enough indexed material yet. Add or finish processing documents first.",
        409,
      )
    }

    // Web augmentation: live search on the focus topic (else the course name).
    if (opts.web) {
      const web = await webSearchContext(topic ?? course.name)
      if (web) text = appendWebContext(text, web)
    }

    const mindMode = opts.mindMode ?? pickMindMode({ topic, weightedTopics: [] })
    const excludeSeen = await seenTexts(scope)
    const set = await orchestrateStudySet(
      text,
      { difficulty, topic, weightedTopics: [], excludeSeen, mindMode },
      { quiz: false }, // quiz is served by the staged endpoint, not the menu set
    )
    if (!set) {
      throw new ApiErrorResponse("Could not generate study material from this course.", 409)
    }

    const served = await bankAndAssemble(scope, set, difficulty, custom)

    if (!custom)
      await StudyRepository.upsertByCourse(courseId, served, fingerprint, STUDY_SCHEMA_VERSION)
    return served
  },

  /**
   * Light status for the estudio menu: whether the default set is already cached
   * (fresh fingerprint + schema) and how many bank items exist per type. Pure SQL —
   * no LLM call — so the menu can render instantly and defer generation to the
   * moment a mode is actually opened.
   */
  async getStudyStatus(
    userId: string,
    scope: StudyScope,
  ): Promise<{ cached: boolean; flashcards: number; quiz: number }> {
    const s = await assertScopeOwned(userId, scope)
    const cachedSet =
      s.kind === "doc"
        ? await StudyRepository.get(
            s.id,
            await ChunkRepository.contentFingerprint(s.id),
            STUDY_SCHEMA_VERSION,
          )
        : await StudyRepository.getByCourse(
            s.id,
            await ChunkRepository.contentFingerprintByCourse(userId, s.id),
            STUDY_SCHEMA_VERSION,
          )
    const [flashcards, quiz] = await Promise.all([
      StudyItemsRepository.countByType(s, "flashcard"),
      StudyItemsRepository.countByType(s, "quiz"),
    ])
    return { cached: cachedSet !== undefined, flashcards, quiz }
  },

  /**
   * One stage of the staged quiz for a syllabus the caller owns. Difficulty
   * escalates per stage (hybrid mastery + `boost`). Items are drawn from the bank
   * and generated lazily (gated) only when the bank is short — nothing is created
   * up front. `excludeIds` are items already served this run (so wrong-answer
   * swaps and later stages don't repeat). 404 when not owned.
   */
  async getQuizStage(
    userId: string,
    syllabusId: string,
    opts: { stage?: number; boost?: number; excludeIds?: string[] } = {},
  ): Promise<QuizStage> {
    const doc = await DocumentRepository.findByIdAndUser(syllabusId, userId)
    if (!doc) throw new ApiErrorResponse("Syllabus not found", 404)

    const stage = Math.min(Math.max(Math.trunc(opts.stage ?? 0), 0), STAGES - 1)
    const boost = Math.min(Math.max(Math.trunc(opts.boost ?? 0), 0), 2)
    const excludeIds = (opts.excludeIds ?? []).slice(0, 200)
    const scope: StudyScope = { kind: "doc", id: syllabusId }

    // Independent reads in parallel: mastery (escalation base), the topic graph,
    // the Repaso exclusion set, and the per-user "already seen" set (no repeats
    // across sessions).
    const [mastery, graph, reviewExclude, seenExclude] = await Promise.all([
      MasteryRepository.listForSyllabus(userId, syllabusId).catch(() => []),
      GraphRepository.getGraph(syllabusId),
      QuizReviewRepository.openItemIds(userId, scope).catch(() => []),
      QuizSeenRepository.seenItemIds(userId, scope).catch(() => []),
    ])
    const masteryAvg =
      mastery.length > 0 ? mastery.reduce((s, m) => s + m.confidence, 0) / mastery.length : 0
    const difficulty = stageDifficulty(stage, masteryAvg, boost)

    // Plan ordering (computed once; reused for generation evidence when needed).
    const { topics } = graph
    const weightedTopics = topics
      .filter((t) => (t.weight_percent ?? 0) > 0)
      .map((t) => ({ label: t.label, weight: Number(t.weight_percent) }))
    const plan = await buildStudyPlan(userId, syllabusId, weightedTopics, difficulty)
    const orderedKeys = plan.targets.map((t) => t.topicKey)
    const planLabels = orderLabelsByPlan(plan)
    const topicLabels = topics.map((t) => t.label.trim()).filter(Boolean)
    const ordered = planLabels.length > 0 ? planLabels : topicLabels

    // Failed questions live in Repaso, and already-seen ones must not repeat →
    // exclude both from stages.
    const allExclude = Array.from(new Set([...excludeIds, ...reviewExclude, ...seenExclude]))
    const items = await stageItems(scope, difficulty, allExclude, async () => {
      const text =
        (await buildContextByTopics({ kind: "doc", id: syllabusId }, ordered)) ??
        (await ChunkRepository.getConcatenatedText(syllabusId))
      return text ? { text, weightedTopics } : null
    })

    const orderedItems = orderByPlan(items, orderedKeys).slice(0, STAGE_POOL)
    return {
      stage,
      stages: STAGES,
      difficulty,
      // Shuffle options on serve: bank payloads keep the generator's biased `answer`.
      questions: orderedItems.map((it) => ({ ...shuffleQuizOptions(it.payload), id: it.id })),
    }
  },

  /**
   * One stage of the staged quiz for a whole course. No per-syllabus mastery, so
   * the escalation is base-0 (fácil→medio→difícil) plus `boost`. 404 when not owned.
   */
  async getCourseQuizStage(
    userId: string,
    courseId: string,
    opts: { stage?: number; boost?: number; excludeIds?: string[] } = {},
  ): Promise<QuizStage> {
    const course = await CourseRepository.findByIdAndUser(courseId, userId)
    if (!course) throw new ApiErrorResponse("Course not found", 404)

    const stage = Math.min(Math.max(Math.trunc(opts.stage ?? 0), 0), STAGES - 1)
    const boost = Math.min(Math.max(Math.trunc(opts.boost ?? 0), 0), 2)
    const excludeIds = (opts.excludeIds ?? []).slice(0, 200)
    const scope: StudyScope = { kind: "course", id: courseId }
    const difficulty = stageDifficulty(stage, 0, boost)

    const [reviewExclude, seenExclude] = await Promise.all([
      QuizReviewRepository.openItemIds(userId, scope).catch(() => []),
      QuizSeenRepository.seenItemIds(userId, scope).catch(() => []),
    ])
    const allExclude = Array.from(new Set([...excludeIds, ...reviewExclude, ...seenExclude]))
    const items = await stageItems(scope, difficulty, allExclude, async () => {
      const text = await ChunkRepository.getConcatenatedTextByCourse(userId, courseId)
      return text ? { text, weightedTopics: [] } : null
    })

    const ordered = orderByPlan(items, []).slice(0, STAGE_POOL)
    return {
      stage,
      stages: STAGES,
      difficulty,
      questions: ordered.map((it) => ({ ...shuffleQuizOptions(it.payload), id: it.id })),
    }
  },

  /**
   * Record a wrong quiz answer: the question leaves the quiz (excluded from future
   * stages) and enters the user's Repaso queue. Ownership-checked.
   */
  async recordQuizFail(userId: string, scope: StudyScope, question: ReviewQuestion): Promise<void> {
    const s = await assertScopeOwned(userId, scope)
    await QuizReviewRepository.add(userId, s, question)
  },

  /**
   * Mark quiz bank items as served to this user, so future sessions never repeat
   * them. Best-effort, ownership-checked. Called by the client at stage/quiz end.
   */
  async recordQuizSeen(userId: string, scope: StudyScope, itemIds: string[]): Promise<void> {
    const s = await assertScopeOwned(userId, scope)
    await QuizSeenRepository.markSeen(userId, s, itemIds)
  },

  /** The user's Repaso queue for a scope: quiz questions still to be re-mastered. */
  async listQuizReview(userId: string, scope: StudyScope): Promise<ReviewQuestion[]> {
    const s = await assertScopeOwned(userId, scope)
    return QuizReviewRepository.listOpen(userId, s)
  },

  /** Resolve a Repaso question (answered correctly) so it drops out of the queue. */
  async resolveQuizReview(userId: string, scope: StudyScope, question: string): Promise<void> {
    const s = await assertScopeOwned(userId, scope)
    await QuizReviewRepository.resolve(userId, s, question)
  },

  /**
   * Record a flashcard review (SRS box update). Thin wrapper over the stats
   * repo so callers (route handler, tools layer) go through the service, not
   * the repo directly. Ownership is implicit via `userId` scoping.
   */
  async recordReview(
    userId: string,
    syllabusId: string,
    cardKey: string,
    known: boolean,
  ): Promise<void> {
    await StudyStatsRepository.recordReview(userId, syllabusId, cardKey, known)
  },
}
