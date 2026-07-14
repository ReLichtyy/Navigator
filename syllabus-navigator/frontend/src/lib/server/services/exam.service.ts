/**
 * server/services/exam.service.ts — the Examen mode: a single-page, timed,
 * submit-once exam with subject-dependent section layout (template).
 *
 * start(): assembles the paper — MCQ from the shared quiz bank (shuffled at
 * serve time), short-answer ('recall') and development ('case') items from the
 * bank when available, generated on demand otherwise — and persists it AS
 * SERVED in exam_attempts. The client receives the paper WITHOUT the hidden
 * grading fields (answer index, expectedAnswer, keyPoints, rubric,
 * modelSolution).
 *
 * grade(): compares the student's answers against the stored paper. MCQ by
 * index (exact — the stored options are post-shuffle); short/dev via ONE
 * batched grader call with partial credit. Fail-CLOSED on grader failure (502,
 * attempt stays gradable) — a silent zero would be a wrong grade. Graded
 * attempts return their stored result idempotently.
 */
import {
  StudyItemsRepository,
  type NewStudyItem,
  type StudyScope,
} from "../repositories/study-items.repo"
import { ExamAttemptsRepository } from "../repositories/exam-attempts.repo"
import { CourseRepository } from "../repositories/course.repo"
import { DocumentRepository } from "../repositories/document.repo"
import { MasteryRepository, topicKey } from "../repositories/mastery.repo"
import { QuizReviewRepository } from "../repositories/quiz-review.repo"
import { QuizSeenRepository } from "../repositories/quiz-seen.repo"
import { assertScopeOwned } from "../utils/scope"
import { ApiErrorResponse } from "../utils/auth-helpers"
import { getUserPrefs } from "../utils/user-prefs"
import { buildEvidence } from "./study-bank.service"
import { recallAgent } from "../rag/agents/recall"
import { caseAgent } from "../rag/agents/case"
import { gradeOpenAnswers, type GradeInput } from "../rag/agents/grader"
import { pctToPoints, totalScore, type CaseItem, type RecallItem } from "../rag/exam-gen"
import { shuffleQuizOptions, type QuizQuestion } from "../rag/study-gen"
import {
  EXAM_TEMPLATES,
  inferTemplate,
  templateTotal,
  type ExamTemplate,
  type ExamTemplateId,
} from "@/lib/ui/exam-template"
import { embedTexts } from "@/lib/llm/embeddings"
import { logError } from "@/lib/observability/logger"

// ── Paper shapes ─────────────────────────────────────────────────────────────
// Stored in exam_attempts.paper WITH the hidden fields; the *API DTO* strips them.

interface PaperMcqItem {
  key: string
  kind: "mcq"
  pointsPerItem: number
  /** Bank id when drawn from study_items (drives quiz_seen/quiz_review). */
  itemId?: string
  question: QuizQuestion // options post-shuffle; answer aligned to them
}

interface PaperShortItem {
  key: string
  kind: "short"
  pointsPerItem: number
  item: RecallItem
}

interface PaperDevItem {
  key: string
  kind: "dev"
  pointsPerItem: number
  item: CaseItem
}

type PaperItem = PaperMcqItem | PaperShortItem | PaperDevItem

interface PaperSection {
  kind: "mcq" | "short" | "dev"
  label: string
  pointsPerItem: number
  items: PaperItem[]
}

interface ExamPaperStored {
  template: ExamTemplateId
  durationSec: number
  sections: PaperSection[]
}

/** What the client sees: no answer, no reference material. */
export interface ExamPaperDTO {
  attempt_id: string
  template: ExamTemplateId
  durationSec: number
  totalPoints: number
  sections: {
    kind: "mcq" | "short" | "dev"
    label: string
    pointsPerItem: number
    items: { key: string; question: string; options?: string[] }[]
  }[]
}

export interface ExamAnswer {
  key: string
  /** MCQ → selected option index; short/dev → free text. */
  response: number | string
}

export interface ExamResultDTO {
  attempt_id: string
  template: ExamTemplateId
  total: number
  maxTotal: number
  sections: {
    kind: "mcq" | "short" | "dev"
    label: string
    items: {
      key: string
      question: string
      score: number
      max: number
      correct: boolean
      yourAnswer: string
      feedback?: string
      correctAnswer?: string
      expectedAnswer?: string
      modelSolution?: string
    }[]
  }[]
}

// Draw window for bank sampling: wide enough that consecutive exams differ.
const MCQ_POOL = 60
const OPEN_POOL_FACTOR = 3

function sample<T>(pool: T[], n: number): T[] {
  const copy = [...pool]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy.slice(0, n)
}

function stripPaper(attemptId: string, paper: ExamPaperStored): ExamPaperDTO {
  return {
    attempt_id: attemptId,
    template: paper.template,
    durationSec: paper.durationSec,
    totalPoints: templateTotal(EXAM_TEMPLATES[paper.template]),
    sections: paper.sections.map((s) => ({
      kind: s.kind,
      label: s.label,
      pointsPerItem: s.pointsPerItem,
      items: s.items.map((it) =>
        it.kind === "mcq"
          ? { key: it.key, question: it.question.question, options: it.question.options }
          : it.kind === "short"
            ? { key: it.key, question: it.item.question }
            : { key: it.key, question: it.item.prompt },
      ),
    })),
  }
}

/** Resolve the exam template: explicit param wins, else infer from the course signal. */
async function resolveTemplate(
  userId: string,
  scope: StudyScope,
  requested: ExamTemplateId | undefined,
): Promise<ExamTemplateId> {
  if (requested && EXAM_TEMPLATES[requested]) return requested
  if (scope.kind === "course") {
    const course = await CourseRepository.findByIdAndUser(scope.id, userId)
    return inferTemplate(course?.subject_tags ?? [], course?.name ?? "")
  }
  const doc = await DocumentRepository.findByIdAndUser(scope.id, userId)
  if (doc?.course_id) {
    const course = await CourseRepository.findByIdAndUser(doc.course_id, userId)
    if (course) return inferTemplate(course.subject_tags ?? [], course.name)
  }
  return inferTemplate([], doc?.original_filename ?? "")
}

/** Best-effort: persist freshly generated open items so later exams reuse them. */
async function bankOpenItems(
  scope: StudyScope,
  recall: RecallItem[],
  cases: CaseItem[],
): Promise<void> {
  const entries: { type: "recall" | "case"; payload: RecallItem | CaseItem; text: string }[] = [
    ...recall.map((r) => ({ type: "recall" as const, payload: r, text: r.question })),
    ...cases.map((c) => ({ type: "case" as const, payload: c, text: c.prompt })),
  ]
  if (entries.length === 0) return
  try {
    const embeddings = await embedTexts(entries.map((e) => e.text))
    const items: NewStudyItem[] = entries.map((e, i) => ({
      userId: null,
      type: e.type,
      topicKey: e.payload.topic ? topicKey(e.payload.topic) : null,
      difficulty: "medio",
      payload: e.payload,
      dedupeText: e.text,
      embedding: embeddings[i],
    }))
    await StudyItemsRepository.insertDeduped(scope, items)
  } catch (err) {
    logError("exam.bank_open_items_failed", {
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

export const ExamService = {
  async start(
    userId: string,
    scope: StudyScope,
    opts: { template?: ExamTemplateId } = {},
  ): Promise<ExamPaperDTO> {
    await assertScopeOwned(userId, scope)
    const templateId = await resolveTemplate(userId, scope, opts.template)
    const template: ExamTemplate = EXAM_TEMPLATES[templateId]

    const counts = Object.fromEntries(template.sections.map((s) => [s.kind, s.count])) as Record<
      "mcq" | "short" | "dev",
      number
    >

    // Bank reads for all three kinds in parallel. The exam deliberately ignores
    // quiz_seen (assessment, not learning flow — excluding seen items would
    // starve the pool for active quiz users); sampling keeps attempts varied.
    const [mcqBank, recallBank, caseBank] = await Promise.all([
      StudyItemsRepository.listRecent<QuizQuestion>(scope, "quiz", MCQ_POOL),
      StudyItemsRepository.listRecent<RecallItem>(scope, "recall", counts.short * OPEN_POOL_FACTOR),
      StudyItemsRepository.listRecent<CaseItem>(scope, "case", counts.dev * OPEN_POOL_FACTOR),
    ])

    const mcqPicks = sample(mcqBank, counts.mcq)
    let recallPicks = sample(recallBank, counts.short).map((b) => b.payload)
    let casePicks = sample(caseBank, counts.dev).map((b) => b.payload)

    // Generate the shortfall of open items on demand, grounded on the same
    // evidence as the quiz bank. MCQ shortfall is served as-is (points are
    // per-item, so maxTotal simply reflects what was served).
    const missingRecall = counts.short - recallPicks.length
    const missingCase = counts.dev - casePicks.length
    if (missingRecall > 0 || missingCase > 0) {
      const ev = await buildEvidence(scope, userId)
      if (!ev || ev.text.trim().length < 80) {
        throw new ApiErrorResponse(
          "El material aún no está listo para generar un examen. Procesa el documento primero.",
          409,
        )
      }
      const prefs = await getUserPrefs(userId)
      const genOpts = { language: prefs.language, weightedTopics: ev.weightedTopics }
      const [freshRecall, freshCase] = await Promise.all([
        missingRecall > 0 ? recallAgent(ev.text, genOpts, missingRecall) : Promise.resolve([]),
        missingCase > 0 ? caseAgent(ev.text, genOpts, missingCase) : Promise.resolve([]),
      ])
      recallPicks = [...recallPicks, ...freshRecall].slice(0, counts.short)
      casePicks = [...casePicks, ...freshCase].slice(0, counts.dev)
      // The paper keeps the fresh items even when dedupe drops them from the
      // bank. Awaited: serverless gives no reliable post-response execution.
      await bankOpenItems(scope, freshRecall, freshCase)
    }
    if (recallPicks.length === 0 && casePicks.length === 0 && mcqPicks.length === 0) {
      throw new ApiErrorResponse(
        "No se pudo armar el examen: no hay material suficiente. Intenta de nuevo.",
        502,
      )
    }

    const sections: PaperSection[] = template.sections
      .map((s): PaperSection => {
        if (s.kind === "mcq") {
          return {
            kind: s.kind,
            label: s.label,
            pointsPerItem: s.pointsPerItem,
            items: mcqPicks.map(
              (b, i): PaperMcqItem => ({
                key: `m${i}`,
                kind: "mcq",
                pointsPerItem: s.pointsPerItem,
                itemId: b.id,
                question: shuffleQuizOptions(b.payload),
              }),
            ),
          }
        }
        if (s.kind === "short") {
          return {
            kind: s.kind,
            label: s.label,
            pointsPerItem: s.pointsPerItem,
            items: recallPicks.map(
              (item, i): PaperShortItem => ({
                key: `s${i}`,
                kind: "short",
                pointsPerItem: s.pointsPerItem,
                item,
              }),
            ),
          }
        }
        return {
          kind: s.kind,
          label: s.label,
          pointsPerItem: s.pointsPerItem,
          items: casePicks.map(
            (item, i): PaperDevItem => ({
              key: `d${i}`,
              kind: "dev",
              pointsPerItem: s.pointsPerItem,
              item,
            }),
          ),
        }
      })
      .filter((s) => s.items.length > 0)

    const paper: ExamPaperStored = {
      template: templateId,
      durationSec: template.durationSec,
      sections,
    }
    const { id } = await ExamAttemptsRepository.create(
      userId,
      scope,
      templateId,
      paper,
      templateTotal(template),
    )
    return stripPaper(id, paper)
  },

  async grade(
    userId: string,
    scope: StudyScope,
    attemptId: string,
    answers: ExamAnswer[],
  ): Promise<ExamResultDTO> {
    await assertScopeOwned(userId, scope)
    const attempt = await ExamAttemptsRepository.findByIdAndUser(attemptId, userId)
    if (!attempt || attempt.scope_kind !== scope.kind || attempt.scope_id !== scope.id) {
      throw new ApiErrorResponse("Examen no encontrado", 404)
    }
    // Submit-once: a graded attempt returns its stored result (retry/double-post safe).
    if (attempt.status === "graded" && attempt.result) {
      return attempt.result as ExamResultDTO
    }

    const paper = attempt.paper as ExamPaperStored
    const byKey = new Map(answers.map((a) => [a.key, a.response]))
    const allItems = paper.sections.flatMap((s) => s.items)

    // Short/dev with a non-empty response → ONE batched grader call. Empty
    // responses score 0 locally (no tokens spent grading silence).
    const openItems = allItems.filter(
      (it): it is PaperShortItem | PaperDevItem => it.kind !== "mcq",
    )
    const toGrade: { item: PaperShortItem | PaperDevItem; input: GradeInput }[] = openItems
      .map((item) => {
        const raw = byKey.get(item.key)
        const response = typeof raw === "string" ? raw.trim() : ""
        if (!response) return null
        const input: GradeInput =
          item.kind === "short"
            ? {
                kind: "short",
                question: item.item.question,
                reference:
                  `Expected answer: ${item.item.expectedAnswer}\n` +
                  `Key points:\n${item.item.keyPoints.map((k) => `- ${k}`).join("\n")}`,
                response,
              }
            : {
                kind: "dev",
                question: item.item.prompt,
                reference:
                  `Rubric:\n${item.item.rubric.map((r) => `- ${r}`).join("\n")}\n` +
                  `Model solution: ${item.item.modelSolution}`,
                response,
              }
        return { item, input }
      })
      .filter((x): x is { item: PaperShortItem | PaperDevItem; input: GradeInput } => x !== null)

    let verdicts: { pct: number; feedback: string }[] = []
    if (toGrade.length > 0) {
      const prefs = await getUserPrefs(userId)
      const graded = await gradeOpenAnswers(
        toGrade.map((t) => t.input),
        prefs.language,
      )
      if (!graded) {
        throw new ApiErrorResponse("No se pudo calificar el examen. Intenta de nuevo.", 502)
      }
      verdicts = graded
    }
    const verdictByKey = new Map(toGrade.map((t, i) => [t.item.key, verdicts[i]]))

    const outcomes: { label: string; correct: boolean }[] = []
    const failedMcq: { question: QuizQuestion; itemId?: string }[] = []
    const servedMcqIds: string[] = []

    const resultSections: ExamResultDTO["sections"] = paper.sections.map((s) => ({
      kind: s.kind,
      label: s.label,
      items: s.items.map((it) => {
        if (it.kind === "mcq") {
          const raw = byKey.get(it.key)
          const picked = typeof raw === "number" ? raw : -1
          const correct = picked === it.question.answer
          const score = correct ? it.pointsPerItem : 0
          if (it.itemId) servedMcqIds.push(it.itemId)
          if (!correct) failedMcq.push({ question: it.question, itemId: it.itemId })
          if (it.question.topic) outcomes.push({ label: it.question.topic, correct })
          return {
            key: it.key,
            question: it.question.question,
            score,
            max: it.pointsPerItem,
            correct,
            yourAnswer: picked >= 0 ? (it.question.options[picked] ?? "—") : "—",
            feedback: it.question.explanation,
            correctAnswer: it.question.options[it.question.answer],
          }
        }
        const raw = byKey.get(it.key)
        const yourAnswer = typeof raw === "string" ? raw.trim() : ""
        const verdict = verdictByKey.get(it.key)
        const pct = verdict ? verdict.pct : 0
        const score = pctToPoints(pct, it.pointsPerItem)
        const correct = Math.min(100, Math.max(0, pct)) >= 50
        const topic = it.item.topic
        if (topic) outcomes.push({ label: topic, correct })
        const base = {
          key: it.key,
          score,
          max: it.pointsPerItem,
          correct,
          yourAnswer: yourAnswer || "—",
          feedback: verdict?.feedback || (yourAnswer ? undefined : "Sin respuesta."),
        }
        return it.kind === "short"
          ? {
              ...base,
              question: it.item.question,
              expectedAnswer: it.item.expectedAnswer,
            }
          : {
              ...base,
              question: it.item.prompt,
              modelSolution: it.item.modelSolution,
            }
      }),
    }))

    const { total, maxTotal } = totalScore(
      resultSections.flatMap((s) => s.items.map((i) => ({ score: i.score, max: i.max }))),
    )
    const result: ExamResultDTO = {
      attempt_id: attemptId,
      template: paper.template,
      total,
      maxTotal,
      sections: resultSections,
    }
    await ExamAttemptsRepository.markGraded(attemptId, result, total, maxTotal)

    // Best-effort side effects: exam outcomes feed the same ledgers as the
    // quiz. Awaited (cheap SQL) because serverless gives no reliable
    // post-response execution; each failure logs without failing the grade.
    await Promise.all([
      outcomes.length > 0
        ? MasteryRepository.recordOutcomes(userId, scope, outcomes).catch((err) =>
            logError("exam.mastery_failed", { error: String(err) }),
          )
        : null,
      ...failedMcq.map((f) =>
        QuizReviewRepository.add(userId, scope, { ...f.question, id: f.itemId }).catch((err) =>
          logError("exam.review_failed", { error: String(err) }),
        ),
      ),
      servedMcqIds.length > 0
        ? QuizSeenRepository.markSeen(userId, scope, servedMcqIds).catch((err) =>
            logError("exam.seen_failed", { error: String(err) }),
          )
        : null,
    ])

    return result
  },
}
