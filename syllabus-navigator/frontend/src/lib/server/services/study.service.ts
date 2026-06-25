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
import { topicKey } from "../repositories/mastery.repo"
import {
  StudyItemsRepository,
  type StudyScope,
  type NewStudyItem,
} from "../repositories/study-items.repo"
import { ApiErrorResponse } from "../utils/auth-helpers"
import { buildContextByTopics } from "../rag/retrieval/hybrid"
import { orchestrateStudySet } from "../rag/orchestrator/runner"
import { buildStudyPlan, orderLabelsByPlan } from "../rag/orchestrator/router"
import { embedTexts } from "@/lib/llm/embeddings"
import { logError } from "@/lib/observability/logger"
import {
  STUDY_SCHEMA_VERSION,
  type StudySet,
  type Difficulty,
  type Flashcard,
  type QuizQuestion,
} from "../rag/study-gen"

// How many bank items to surface in an assembled default set (keeps UI counts sane).
const SET_FLASHCARDS = 14
const SET_QUIZ = 10

/** Flatten a generated set into bank items (dedupe text + payload + topic). Pure. */
function decompose(set: StudySet): { dedupeText: string; type: "flashcard" | "quiz"; topicKey: string | null; payload: unknown }[] {
  const out: { dedupeText: string; type: "flashcard" | "quiz"; topicKey: string | null; payload: unknown }[] = []
  for (const f of set.flashcards) out.push({ dedupeText: f.front, type: "flashcard", topicKey: null, payload: f })
  for (const q of set.quiz) {
    out.push({ dedupeText: q.question, type: "quiz", topicKey: q.topic ? topicKey(q.topic) : null, payload: q })
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
 */
async function bankAndAssemble(
  scope: StudyScope,
  set: StudySet,
  difficulty: Difficulty,
  custom: boolean,
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
    if (custom) return set

    const [bankFlash, bankQuiz] = await Promise.all([
      StudyItemsRepository.listRecent<Flashcard>(scope, "flashcard", SET_FLASHCARDS),
      StudyItemsRepository.listRecent<QuizQuestion>(scope, "quiz", SET_QUIZ),
    ])
    return {
      ...set,
      flashcards: bankFlash.length > 0 ? bankFlash.map((b) => b.payload) : set.flashcards,
      quiz: bankQuiz.length > 0 ? bankQuiz.map((b) => b.payload) : set.quiz,
    }
  } catch (err) {
    logError("study.bank.error", { error: err instanceof Error ? err.message : String(err) })
    return set // banking failed → still serve the freshly generated set
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
    opts: { refresh?: boolean; difficulty?: Difficulty; topic?: string } = {},
  ): Promise<StudySet> {
    const doc = await DocumentRepository.findByIdAndUser(syllabusId, userId)
    if (!doc) throw new ApiErrorResponse("Syllabus not found", 404)

    const topic = opts.topic?.trim() || undefined
    const difficulty = opts.difficulty ?? "medio"
    const custom = !!topic || difficulty !== "medio"
    const scope: StudyScope = { kind: "doc", id: syllabusId }
    const fingerprint = await ChunkRepository.contentFingerprint(syllabusId)

    // Default set is cacheable; custom (topic/difficulty) sets are always fresh.
    if (!opts.refresh && !custom) {
      const cached = await StudyRepository.get(syllabusId, fingerprint, STUDY_SCHEMA_VERSION)
      if (cached) return cached
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
    const text =
      (await buildContextByTopics({ kind: "doc", id: syllabusId }, labels)) ??
      (await ChunkRepository.getConcatenatedText(syllabusId))
    if (!text || text.trim().length < 80) {
      throw new ApiErrorResponse(
        "This course doesn't have enough indexed material yet. Try again once processing finishes.",
        409,
      )
    }

    // Step 3+4: specialized agents (flashcard/inquisitor/synth) + answer-correctness
    // gate, instead of one mega-call.
    const excludeSeen = await seenTexts(scope)
    const set = await orchestrateStudySet(text, { difficulty, topic, weightedTopics, excludeSeen })
    if (!set) {
      throw new ApiErrorResponse("Could not generate study material from this course.", 409)
    }

    const served = await bankAndAssemble(scope, set, difficulty, custom)

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
    opts: { refresh?: boolean; difficulty?: Difficulty; topic?: string } = {},
  ): Promise<StudySet> {
    const course = await CourseRepository.findByIdAndUser(courseId, userId)
    if (!course) throw new ApiErrorResponse("Course not found", 404)

    const topic = opts.topic?.trim() || undefined
    const difficulty = opts.difficulty ?? "medio"
    const custom = !!topic || difficulty !== "medio"
    const scope: StudyScope = { kind: "course", id: courseId }
    const fingerprint = await ChunkRepository.contentFingerprintByCourse(userId, courseId)

    if (!opts.refresh && !custom) {
      const cached = await StudyRepository.getByCourse(courseId, fingerprint, STUDY_SCHEMA_VERSION)
      if (cached) return cached
    }

    // Step 2: when a focus topic is given, retrieve it across the whole course
    // (hybrid). Otherwise use the full concatenated text (no course-level topic
    // graph yet — see rag-report §8.5).
    const focusLabels = topic ? [topic] : []
    const text =
      (await buildContextByTopics({ kind: "course", id: courseId, userId }, focusLabels)) ??
      (await ChunkRepository.getConcatenatedTextByCourse(userId, courseId))
    if (!text || text.trim().length < 80) {
      throw new ApiErrorResponse(
        "This course doesn't have enough indexed material yet. Add or finish processing documents first.",
        409,
      )
    }

    const excludeSeen = await seenTexts(scope)
    const set = await orchestrateStudySet(text, { difficulty, topic, weightedTopics: [], excludeSeen })
    if (!set) {
      throw new ApiErrorResponse("Could not generate study material from this course.", 409)
    }

    const served = await bankAndAssemble(scope, set, difficulty, custom)

    if (!custom) await StudyRepository.upsertByCourse(courseId, served, fingerprint, STUDY_SCHEMA_VERSION)
    return served
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
