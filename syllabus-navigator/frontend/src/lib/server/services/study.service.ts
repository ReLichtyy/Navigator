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
import { assertScopeOwned } from "../utils/scope"
import { getUserPrefs } from "../utils/user-prefs"
import { buildContextByTopics } from "../rag/retrieval/hybrid"
import { webSearchContext, appendWebContext } from "../rag/web-search"
import { orchestrateStudySet } from "../rag/orchestrator/runner"
import { StudyBankService } from "./study-bank.service"
import { buildStudyPlan, orderLabelsByPlan } from "../rag/orchestrator/router"
import { embedTexts } from "@/lib/llm/embeddings"
import { logError } from "@/lib/observability/logger"
import {
  STUDY_SCHEMA_VERSION,
  shuffleQuizOptions,
  type StudySet,
  type Difficulty,
  type CardFormat,
  type Flashcard,
  type QuizQuestion,
} from "../rag/study-gen"

// ── Configuración → Study Engine mappings (the UI stores Spanish labels) ─────
// "Adaptativa" maps to no default: difficulty stays automatic.
const PREF_DIFFICULTY: Record<string, Difficulty> = {
  Fácil: "facil",
  Media: "medio",
  Difícil: "dificil",
}
const PREF_CARD_FORMAT: Record<string, CardFormat> = {
  "Pregunta y respuesta": "qa",
  "Rellenar huecos": "cloze",
  Definición: "definition",
  Mixto: "mixed",
}

interface StudyPrefs {
  language: string
  /** Default difficulty from settings (undefined = Adaptativa/none). */
  difficulty?: Difficulty
  cardFormat?: CardFormat
  /** Preferred quiz size per stage (5/10/15). */
  questionCount?: number
}

/** Resolve the user's study-relevant preferences (cached via getUserPrefs). */
async function getStudyPrefs(userId: string): Promise<StudyPrefs> {
  const prefs = await getUserPrefs(userId)
  const study = prefs.profile.study ?? {}
  return {
    language: prefs.language,
    difficulty: study.difficulty ? PREF_DIFFICULTY[study.difficulty] : undefined,
    cardFormat: study.cardFormat ? PREF_CARD_FORMAT[study.cardFormat] : undefined,
    questionCount: study.questionCount,
  }
}

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
// Quiz item generation no longer happens inline here — it runs as background
// `study-bank` jobs (see study-bank.service.ts), filling the bank to
// BANK_TARGET_PER_DIFFICULTY across several short requests. This serve path only
// reads the bank, kicks a fill job when short, and recycles when exhausted.
const DIFFICULTY_LADDER: Difficulty[] = ["facil", "medio", "dificil"]

// ── Warm budget (cost control) ───────────────────────────────────────────────
// Background warming exists to keep the student from waiting, NOT to build a
// complete bank: every batch is a real gen→gate→embed chain (6 LLM calls), so an
// unbounded warm is an unbounded bill. Three limits keep it to a middle ground:
//
//   WARM_TARGET  — warm only fills a rung to "enough for a couple of stages",
//                  well below BANK_TARGET_PER_DIFFICULTY. Past this, the rung is
//                  only topped up on demand (a serve request with an empty pool)
//                  or by the cron. Free once reached: `ensure` no-ops, `drain`
//                  finds no job, and the whole call costs two counts.
//   WARM_BATCHES — one generation per call. The client warms repeatedly, so the
//                  bank still climbs; it just climbs in cheap steps.
//   warmRungs()  — only the rungs this student will actually play.
const WARM_TARGET = 30
const WARM_BATCHES = 1

/**
 * The rungs worth pre-filling for this student: the one they start on, plus the
 * next one up (which they reach after clearing stage 1). Warming the whole ladder
 * would pay for `dificil` questions most students never see.
 */
function warmRungs(pref: Difficulty | undefined, mastery: { confidence: number }[]): Difficulty[] {
  const avg =
    mastery.length > 0 ? mastery.reduce((s, m) => s + m.confidence, 0) / mastery.length : 0
  const base = ladderBase(pref, avg)
  const next = Math.min(DIFFICULTY_LADDER.length - 1, base + 1)
  return base === next
    ? [DIFFICULTY_LADDER[base]]
    : [DIFFICULTY_LADDER[base], DIFFICULTY_LADDER[next]]
}

/** A staged-quiz question carries its bank id so the client can exclude served items. */
export interface StageQuestion extends QuizQuestion {
  id: string
}
export interface QuizStage {
  stage: number
  stages: number
  difficulty: Difficulty
  /**
   * Ladder index stage 0 starts from (0=fácil, 1=medio, 2=difícil). The client
   * needs it to know whether the NEXT stage is actually harder — without it the
   * between-stage screen promises an escalation that may not exist.
   */
  base: number
  /** Correct answers required to clear this stage (user pref; default STAGE_SIZE). */
  size: number
  questions: StageQuestion[]
  /** A background fill job is still producing questions → client keeps polling. */
  generating?: boolean
  /** Bank truly exhausted (no items, no recyclable material) → client shows the aviso. */
  exhausted?: boolean
}

/**
 * Where the ladder starts. An explicit Configuración difficulty anchors stage 0;
 * with "Adaptativa" (no pref) mastery decides, so a strong student skips `fácil`.
 */
function ladderBase(pref: Difficulty | undefined, masteryAvg: number): number {
  if (pref) return DIFFICULTY_LADDER.indexOf(pref)
  return masteryAvg >= 0.6 ? 1 : 0
}

/**
 * Hybrid escalation: `base` sets the starting rung, the stage index climbs the
 * ladder, and the client-supplied `boost` (earned by acing prior stages)
 * accelerates it. Never drops below the base — failing a stage doesn't punish.
 */
function stageDifficulty(stage: number, base: number, boost: number): Difficulty {
  const idx = Math.min(DIFFICULTY_LADDER.length - 1, Math.max(0, base + stage + boost))
  return DIFFICULTY_LADDER[idx]
}

/** Postgres casts the exclude list to uuid[] — a malformed id would 500 the route. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const sanitizeIds = (ids: string[] | undefined): string[] =>
  (ids ?? []).filter((id) => UUID_RE.test(id)).slice(0, 200)

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

type StageItem = { id: string; topicKey: string | null; payload: QuizQuestion }

/**
 * Serve a stage's bank items. When the bank is short we kick a background fill job
 * (dedupe-guarded) and, ONLY if we'd otherwise return an empty screen, drain that
 * job inline so this request produces the first batch itself.
 *
 * Draining is a full LLM generation, so it must not be on the path of a request
 * that already has something to serve: a short-but-non-empty pool is returned
 * immediately with `generating: true`, and the client's background top-up picks up
 * the rest. The inline drain is targeted at THIS (scope, difficulty) — an
 * unfiltered claim would burn the invocation on another scope's bank.
 *
 * If the pool is still empty we recycle already-seen items of this difficulty, or
 * report exhaustion so the client shows the aviso instead of hanging.
 *
 * `clientExclude`/`reviewExclude` are always honored; `seenExclude` is what recycle
 * drops. Returns the pool plus `generating`/`exhausted` flags for the client.
 */
async function fillDrainRecycle(
  userId: string,
  scope: StudyScope,
  difficulty: Difficulty,
  clientExclude: string[],
  reviewExclude: string[],
  seenExclude: string[],
  sizes: { need: number; pool: number },
  ownerId: string | undefined,
  language: string | undefined,
): Promise<{ items: StageItem[]; generating: boolean; exhausted: boolean }> {
  const map = (
    rows: { id: string; topicKey: string | null; payload: QuizQuestion }[],
  ): StageItem[] => rows.map((p) => ({ id: p.id, topicKey: p.topicKey, payload: p.payload }))
  const read = (exclude: string[]) =>
    StudyItemsRepository.listForStage<QuizQuestion>(scope, "quiz", difficulty, sizes.pool, exclude)

  const allExclude = Array.from(new Set([...clientExclude, ...reviewExclude, ...seenExclude]))
  let pool = await read(allExclude)
  if (pool.length >= sizes.need) return { items: map(pool), generating: false, exhausted: false }

  // Short bank → enqueue a fill. Cheap: a count plus a dedupe-guarded insert.
  await StudyBankService.ensure(scope, difficulty, ownerId, language)

  // Something to serve already → hand it over now and let the fill run in the
  // background (cron, or the next poll that finds an empty pool). Blocking on a
  // generation here would add ~a minute to a request that didn't need it.
  if (pool.length > 0) {
    const generating = await StudyBankService.hasPending(scope, difficulty)
    return { items: map(pool), generating, exhausted: false }
  }

  // Empty pool: this request has nothing to show, so it does the work itself.
  await StudyBankService.drain(1, { scope, difficulty }).catch((err) =>
    logError("study.stage.drain_error", {
      error: err instanceof Error ? err.message : String(err),
    }),
  )
  pool = await read(allExclude)
  const generating = await StudyBankService.hasPending(scope, difficulty)
  if (pool.length > 0) return { items: map(pool), generating, exhausted: false }
  if (generating) return { items: [], generating: true, exhausted: false }

  // Nothing to serve and nothing in flight. If dropping the seen ledger would
  // surface items, everything at this difficulty has simply been answered before
  // → recycle. Only clear the ledger when it's actually the blocker (an empty pool
  // caused by client/review excludes alone must not wipe the student's history).
  const recycleExclude = Array.from(new Set([...clientExclude, ...reviewExclude]))
  const recyclable = seenExclude.length > 0 ? await read(recycleExclude) : []
  if (recyclable.length > 0) {
    await QuizSeenRepository.clearForScopeDifficulty(userId, scope, difficulty)
    return { items: map(recyclable), generating: false, exhausted: false }
  }

  // No items at this difficulty at all (or every one still excluded this run).
  return { items: [], generating: false, exhausted: true }
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
  /**
   * Web-augmented sets are grounded on live search results, not on the course's
   * own material. They're served to whoever asked for them, but they must NOT
   * enter the shared bank — from there they'd be resurfaced as if the syllabus
   * itself taught them.
   */
  web = false,
): Promise<StudySet> {
  try {
    const items = decompose(set)
    if (items.length > 0 && !web) {
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
    } = {},
  ): Promise<StudySet> {
    const doc = await DocumentRepository.findByIdAndUser(syllabusId, userId)
    if (!doc) throw new ApiErrorResponse("Syllabus not found", 404)

    const topic = opts.topic?.trim() || undefined
    // Per-user prefs (Configuración): output language, default difficulty and
    // card format. An explicit ?difficulty query param still wins over the pref.
    const { language, difficulty: prefDifficulty, cardFormat } = await getStudyPrefs(userId)
    const difficulty = opts.difficulty ?? prefDifficulty ?? "medio"
    // Web-augmented sets pull live external context → always fresh, never cached
    // (so they can't clobber the canonical doc-only default set). An explicit mind
    // mode override is likewise a one-off request, not the canonical default.
    // Note: only an EXPLICIT difficulty makes the set custom — the pref-driven
    // default shapes the canonical cached set instead (changing the pref takes
    // effect on the next refresh, not retroactively on the cached set).
    const custom =
      !!topic || (opts.difficulty !== undefined && opts.difficulty !== "medio") || !!opts.web
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
    const plan = await buildStudyPlan(userId, scope, weightedTopics, difficulty)
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
      const web = await webSearchContext(query, language)
      if (web) text = appendWebContext(text, web)
    }

    // Step 3+4: specialized agents (flashcard/inquisitor/synth) + answer-
    // correctness gate, instead of one mega-call.
    const excludeSeen = await seenTexts(scope)
    const set = await orchestrateStudySet(
      text,
      { difficulty, topic, weightedTopics, excludeSeen, language, cardFormat },
      { quiz: false }, // quiz is served by the staged endpoint, not the menu set
    )
    if (!set) {
      throw new ApiErrorResponse("Could not generate study material from this course.", 409)
    }

    // Reconnect the Router → served set: rank the assembled quiz by plan priority.
    const orderedKeys = plan.targets.map((t) => t.topicKey)
    const served = await bankAndAssemble(scope, set, difficulty, custom, orderedKeys, !!opts.web)

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
    } = {},
  ): Promise<StudySet> {
    const course = await CourseRepository.findByIdAndUser(courseId, userId)
    if (!course) throw new ApiErrorResponse("Course not found", 404)

    const topic = opts.topic?.trim() || undefined
    // Per-user prefs (see getStudySet for the semantics).
    const { language, difficulty: prefDifficulty, cardFormat } = await getStudyPrefs(userId)
    const difficulty = opts.difficulty ?? prefDifficulty ?? "medio"
    // Web-augmented sets are always fresh (see getStudySet).
    const custom =
      !!topic || (opts.difficulty !== undefined && opts.difficulty !== "medio") || !!opts.web
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
      const web = await webSearchContext(topic ?? course.name, language)
      if (web) text = appendWebContext(text, web)
    }

    const excludeSeen = await seenTexts(scope)
    const set = await orchestrateStudySet(
      text,
      { difficulty, topic, weightedTopics: [], excludeSeen, language, cardFormat },
      { quiz: false }, // quiz is served by the staged endpoint, not the menu set
    )
    if (!set) {
      throw new ApiErrorResponse("Could not generate study material from this course.", 409)
    }

    const served = await bankAndAssemble(scope, set, difficulty, custom, [], !!opts.web)

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
    const excludeIds = sanitizeIds(opts.excludeIds)
    const scope: StudyScope = { kind: "doc", id: syllabusId }

    // Independent reads in parallel: mastery (escalation base), the topic graph,
    // the Repaso exclusion set, the per-user "already seen" set (no repeats
    // across sessions), and the user's prefs (output language, difficulty, size).
    const [mastery, graph, reviewExclude, seenExclude, prefs] = await Promise.all([
      MasteryRepository.listForScope(userId, scope).catch(() => []),
      GraphRepository.getGraph(syllabusId),
      QuizReviewRepository.openItemIds(userId, scope).catch(() => []),
      QuizSeenRepository.seenItemIds(userId, scope).catch(() => []),
      getStudyPrefs(userId),
    ])
    // Preguntas por quiz (Configuración): stage size + the same swap buffer.
    const size = prefs.questionCount ?? STAGE_SIZE
    const poolSize = size + (STAGE_POOL - STAGE_SIZE)
    const masteryAvg =
      mastery.length > 0 ? mastery.reduce((s, m) => s + m.confidence, 0) / mastery.length : 0
    // Dificultad (Configuración) anchors the ladder; "Adaptativa" leaves it to mastery.
    const base = ladderBase(prefs.difficulty, masteryAvg)
    const difficulty = stageDifficulty(stage, base, boost)

    // Plan ordering (computed once; reused for generation evidence when needed).
    const { topics } = graph
    const weightedTopics = topics
      .filter((t) => (t.weight_percent ?? 0) > 0)
      .map((t) => ({ label: t.label, weight: Number(t.weight_percent) }))
    const plan = await buildStudyPlan(userId, scope, weightedTopics, difficulty)
    const orderedKeys = plan.targets.map((t) => t.topicKey)

    // Read the bank (background jobs generate it — never inline here). Failed
    // questions live in Repaso and already-seen ones must not repeat within a run.
    const { items, generating, exhausted } = await fillDrainRecycle(
      userId,
      scope,
      difficulty,
      excludeIds,
      reviewExclude,
      seenExclude,
      { need: size, pool: poolSize },
      userId,
      prefs.language,
    )

    const orderedItems = orderByPlan(items, orderedKeys).slice(0, poolSize)
    return {
      stage,
      stages: STAGES,
      difficulty,
      base,
      size,
      generating,
      exhausted,
      // Shuffle options on serve: bank payloads keep the generator's biased `answer`.
      questions: orderedItems.map((it) => ({ ...shuffleQuizOptions(it.payload), id: it.id })),
    }
  },

  /**
   * One stage of the staged quiz for a whole course. Since the mastery ledger is
   * scope-based, this escalates off the student's REAL course mastery — it used to
   * be hardcoded to 0, so a whole-course quiz never adapted. 404 when not owned.
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
    const excludeIds = sanitizeIds(opts.excludeIds)
    const scope: StudyScope = { kind: "course", id: courseId }

    const [mastery, reviewExclude, seenExclude, prefs] = await Promise.all([
      MasteryRepository.listForScope(userId, scope).catch(() => []),
      QuizReviewRepository.openItemIds(userId, scope).catch(() => []),
      QuizSeenRepository.seenItemIds(userId, scope).catch(() => []),
      getStudyPrefs(userId),
    ])
    const size = prefs.questionCount ?? STAGE_SIZE
    const poolSize = size + (STAGE_POOL - STAGE_SIZE)
    const masteryAvg =
      mastery.length > 0 ? mastery.reduce((s, m) => s + m.confidence, 0) / mastery.length : 0
    const base = ladderBase(prefs.difficulty, masteryAvg)
    const difficulty = stageDifficulty(stage, base, boost)
    const { items, generating, exhausted } = await fillDrainRecycle(
      userId,
      scope,
      difficulty,
      excludeIds,
      reviewExclude,
      seenExclude,
      { need: size, pool: poolSize },
      userId, // ownerId — whole-course evidence is assembled from this user's docs
      prefs.language,
    )

    const ordered = orderByPlan(items, []).slice(0, poolSize)
    return {
      stage,
      stages: STAGES,
      difficulty,
      base,
      size,
      generating,
      exhausted,
      questions: ordered.map((it) => ({ ...shuffleQuizOptions(it.payload), id: it.id })),
    }
  },

  /**
   * Fill the question bank OFF the critical path.
   *
   * The bank only grows when a `study-bank` job is drained, and the only drainers
   * are (a) the daily cron and (b) a serve request that found an empty pool. So
   * without this, every generation lands inside a request the student is waiting
   * on — which is why the quiz sat at "90%" on every open, not just the first.
   *
   * The client calls this fire-and-forget while the student is reading the menu or
   * answering the current stage (minutes of idle), so by the time they need the
   * next questions the bank already has them. Idempotent and ownership-checked;
   * concurrent calls can't double-generate (atomic claim + job dedupe).
   */
  async warmBank(
    userId: string,
    scope: StudyScope,
    opts: { difficulties?: Difficulty[]; batches?: number } = {},
  ): Promise<{ drained: number; rungs: Difficulty[] }> {
    const s = await assertScopeOwned(userId, scope)
    const [prefs, mastery] = await Promise.all([
      getStudyPrefs(userId),
      MasteryRepository.listForScope(userId, s).catch(() => []),
    ])

    // Only the rungs this student is actually about to play, and only up to
    // WARM_TARGET — not the full BANK_TARGET. Warming all three to 70 would burn
    // ~6× the LLM calls for questions most students never reach.
    const rungs = opts.difficulties ?? warmRungs(prefs.difficulty, mastery)
    for (const d of rungs) {
      await StudyBankService.ensure(s, d, userId, prefs.language, WARM_TARGET)
    }

    // Drain what's queued for THIS scope (the claim is filtered per
    // scope+difficulty, so this can't burn the invocation on someone else's bank).
    // Best-effort: a generation failure must not fail the warm call.
    const budget = opts.batches ?? WARM_BATCHES
    let drained = 0
    for (const d of rungs) {
      if (drained >= budget) break
      const { processed } = await StudyBankService.drain(budget - drained, {
        scope: s,
        difficulty: d,
      }).catch(() => ({ processed: 0, failed: 0 }))
      drained += processed
    }
    return { drained, rungs }
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

  /**
   * The user's Repaso queue for a scope: quiz questions still to be re-mastered.
   * Options are reshuffled on every serve — the stored payload keeps whatever
   * position the answer had when the question was failed, so serving it verbatim
   * would let the student re-master the POSITION instead of the concept.
   */
  async listQuizReview(userId: string, scope: StudyScope): Promise<ReviewQuestion[]> {
    const s = await assertScopeOwned(userId, scope)
    const open = await QuizReviewRepository.listOpen(userId, s)
    return open.map((q) => ({ ...shuffleQuizOptions(q), id: q.id }))
  },

  /** Resolve a Repaso question (answered correctly) so it drops out of the queue. */
  async resolveQuizReview(userId: string, scope: StudyScope, question: string): Promise<void> {
    const s = await assertScopeOwned(userId, scope)
    await QuizReviewRepository.resolve(userId, s, question)
  },

  /**
   * Record a flashcard review (SRS box update) against a scope the caller owns.
   * Works for whole-course scope now — before, the course's flashcards recorded
   * nothing, so neither the streak nor the SRS queue ever saw them.
   */
  async recordReview(
    userId: string,
    scope: StudyScope,
    cardKey: string,
    known: boolean,
  ): Promise<void> {
    const s = await assertScopeOwned(userId, scope)
    await StudyStatsRepository.recordReview(userId, s, cardKey, known)
  },
}
