/**
 * server/rag/study-gen.ts â€” generate a per-course "study set" from the syllabus
 * material: flashcards, a multiple-choice quiz, an auto-summary and a mind map.
 *
 * Same shape as graph-gen.ts / schedule-gen.ts: one gateway (gpt-5.4) JSON call
 * â†’ validated + normalized rows. Powers the "Ãrea de Estudio" window.
 */

import { z } from "zod"

// ---------- public shape (what the UI consumes) ----------

export interface Flashcard {
  front: string
  back: string
}

export interface QuizQuestion {
  question: string
  options: string[] // 2â€“5 options
  answer: number // index into options
  explanation: string
  /** Topic this question assesses (a mind-map branch / weighted topic label). Feeds the mastery ledger. */
  topic?: string
}

export interface SummaryPoint {
  title: string
  body: string
}

export interface MindBranch {
  label: string
  items: string[]
}

/** A weighted study-guide section, ordered by exam importance. */
export interface StudyGuideSection {
  topic: string
  weight: number // 0â€“100 (exam weight, 0 when unknown)
  points: string[]
}

/**
 * Bump when the generator output shape / prompt contract changes meaningfully.
 * The versioned cache reuses a stored set only when its schema_version matches,
 * so a bump invalidates every cached set after deploy.
 */
export const STUDY_SCHEMA_VERSION = 2

export interface StudySet {
  flashcards: Flashcard[]
  quiz: QuizQuestion[]
  summary: { intro: string; points: SummaryPoint[] }
  mindmap: { center: string; branches: MindBranch[] }
  /** Ordered, weight-prioritized study guide (Sprint 4). Optional for old cached sets. */
  studyGuide?: StudyGuideSection[]
}

// ---------- LLM contract ----------

const StudySchema = z.object({
  flashcards: z.array(z.object({ front: z.string(), back: z.string() })),
  quiz: z.array(
    z.object({
      question: z.string(),
      options: z.array(z.string()),
      answer: z.number(),
      explanation: z.string(),
      // Optional so old cached sets (no topic) still validate.
      topic: z.string().optional(),
    }),
  ),
  summary: z.object({
    intro: z.string(),
    points: z.array(z.object({ title: z.string(), body: z.string() })),
  }),
  mindmap: z.object({
    center: z.string(),
    branches: z.array(z.object({ label: z.string(), items: z.array(z.string()) })),
  }),
  studyGuide: z
    .array(z.object({ topic: z.string(), weight: z.number(), points: z.array(z.string()) }))
    .optional(),
})

type RawStudy = z.infer<typeof StudySchema>

/**
 * Shared content policy for EVERY study-generation agent (flashcard, inquisitor,
 * synth) and the Critic that gates them. THE key rule: teach the course's SUBJECT,
 * not the syllabus document.
 *
 * The uploaded material is frequently just an outline (topic titles, schedule, exam
 * weights). The only things "literally in it" are then administrative, so anchoring
 * strictly to the verbatim text yields useless meta-questions ("in which week is X
 * taught?", "what % is the midterm worth?"). Instead, develop the established
 * academic content of the topics the course names, so the student is taught and
 * tested on the actual subject. Keep generator and critic wording in sync via this
 * one constant â€” if they diverge, the gate quietly undoes the generator.
 */
export const SUBJECT_GROUNDING_POLICY =
  "GROUND IN THE SUBJECT, NOT THE DOCUMENT. The material may be full course notes OR just a " +
  "syllabus/outline (topic titles, schedule, weights). Build every item from the ACADEMIC CONTENT of " +
  "the course's topics: when the material explains a concept, use that explanation; when it only NAMES " +
  "a topic, develop that topic's standard, well-established subject content yourself (definitions, " +
  "principles, methods, worked reasoning, examples) so the student learns and is tested on the actual " +
  "subject. NEVER write items about the document's administrative or structural metadata â€” schedule, " +
  "dates, weeks/session numbers, exam or assignment weights/percentages, grading policy, instructor, " +
  "bibliography entries, or 'what the syllabus/program says'. Stay strictly ON the course's topics: do " +
  "not drift to unrelated subjects, and do not fabricate course-specific particulars (made-up figures, " +
  "fake citations, invented data presented as if from the material). Preserve the language of the material."

/**
 * Validate + normalize a raw model object into a safe StudySet.
 * Pure (no network) so it can be unit-tested:
 *  - drops empty flashcards / quiz questions,
 *  - keeps quiz items with â‰¥2 options and clamps `answer` into range,
 *  - trims strings.
 * Returns null when the material yielded nothing usable.
 */
export function normalizeStudySet(raw: unknown): StudySet | null {
  const parsed = StudySchema.safeParse(raw)
  if (!parsed.success) return null
  const r: RawStudy = parsed.data

  const flashcards: Flashcard[] = r.flashcards
    .map((f) => ({ front: f.front.trim(), back: f.back.trim() }))
    .filter((f) => f.front.length > 0 && f.back.length > 0)

  const quiz: QuizQuestion[] = r.quiz
    .map((q) => {
      const options = q.options.map((o) => o.trim()).filter((o) => o.length > 0)
      const answer = Math.min(Math.max(Math.trunc(q.answer), 0), Math.max(options.length - 1, 0))
      const topic = q.topic?.trim()
      return {
        question: q.question.trim(),
        options,
        answer,
        explanation: q.explanation.trim(),
        ...(topic ? { topic } : {}),
      }
    })
    .filter((q) => q.question.length > 0 && q.options.length >= 2)

  const points: SummaryPoint[] = r.summary.points
    .map((p) => ({ title: p.title.trim(), body: p.body.trim() }))
    .filter((p) => p.title.length > 0 || p.body.length > 0)

  const branches: MindBranch[] = r.mindmap.branches
    .map((b) => ({ label: b.label.trim(), items: b.items.map((i) => i.trim()).filter(Boolean) }))
    .filter((b) => b.label.length > 0)

  const studyGuide: StudyGuideSection[] = (r.studyGuide ?? [])
    .map((s) => ({
      topic: s.topic.trim(),
      weight: Math.min(Math.max(s.weight, 0), 100),
      points: s.points.map((p) => p.trim()).filter(Boolean),
    }))
    .filter((s) => s.topic.length > 0 && s.points.length > 0)
    .sort((a, b) => b.weight - a.weight)

  const set: StudySet = {
    flashcards,
    quiz,
    summary: { intro: r.summary.intro.trim(), points },
    mindmap: { center: r.mindmap.center.trim(), branches },
    ...(studyGuide.length > 0 ? { studyGuide } : {}),
  }

  // Nothing usable at all â†’ signal "not enough material".
  if (set.flashcards.length === 0 && set.quiz.length === 0 && set.summary.points.length === 0) {
    return null
  }
  return set
}

/**
 * Shuffle a question's options (Fisher-Yates) remapping `answer` to follow the
 * correct option. Applied at SERVE time (not generation) so items already
 * persisted with a position-biased `answer` are covered too, and the same item
 * shows a different order on every serve. `rand` is injectable for deterministic
 * tests (defaults to Math.random). Pure â€” returns a new object.
 */
export function shuffleQuizOptions(
  q: QuizQuestion,
  rand: () => number = Math.random,
): QuizQuestion {
  const order = q.options.map((_, i) => i)
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  return {
    ...q,
    options: order.map((i) => q.options[i]),
    answer: order.indexOf(q.answer),
  }
}

export type Difficulty = "facil" | "medio" | "dificil"

export interface StudyGenOptions {
  /** Tunes how demanding the generated quiz/flashcards are. Default "medio". */
  difficulty?: Difficulty
  /** When set, focus the material on this specific topic (from the cronograma). */
  topic?: string
  /** Course graph topics + exam weights â€” bias generation & order the study guide by importance. */
  weightedTopics?: { label: string; weight: number }[]
  /**
   * Flashcard fronts / quiz questions ALREADY in the item bank. The model is told
   * not to repeat them, so every refresh yields genuinely new items (anti-repeat).
   */
  excludeSeen?: string[]
}

const DIFFICULTY_HINT: Record<Difficulty, string> = {
  facil:
    "DIFFICULTY: EASY. Stick to foundational concepts and definitions, straightforward recall, simple wording. Quiz distractors should be clearly wrong.",
  medio:
    "DIFFICULTY: MEDIUM. Balance recall with light application. Quiz distractors should be plausible but distinguishable.",
  dificil:
    "DIFFICULTY: HARD. Emphasize reasoning, edge cases, application and analysis over recall. Quiz distractors must be subtle and tempting; explanations must justify why each is wrong.",
}

/** Build the extra instruction block from difficulty + optional topic focus. Pure â†’ testable. */
export function buildDirectives(opts: StudyGenOptions): string {
  const lines = [DIFFICULTY_HINT[opts.difficulty ?? "medio"]]
  const topic = opts.topic?.trim()
  if (topic) {
    lines.push(
      `FOCUS: Follow this user instruction when generating the material: "${topic}". Treat it as the scope/emphasis â€” prioritize content from the material that matches it and ignore unrelated sections. If the material barely covers it, do your best with what is present (still never invent facts).`,
    )
  }
  const weighted = (opts.weightedTopics ?? [])
    .filter((t) => t.label.trim().length > 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 12)
  if (weighted.length > 0) {
    const list = weighted.map((t) => `- ${t.label} (${Math.round(t.weight)}%)`).join("\n")
    lines.push(
      "WEIGHTED TOPICS (exam importance, highest first). Prioritize the heavier topics: allocate more flashcards/quiz questions to them, set each quiz question's `topic` to the matching label, and order `studyGuide` from heaviest to lightest weight:\n" +
        list,
    )
  }
  const seen = (opts.excludeSeen ?? [])
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 120)
  if (seen.length > 0) {
    const list = seen.map((s) => `- ${s}`).join("\n")
    lines.push(
      "ALREADY COVERED â€” do NOT repeat or lightly reword any of these; generate flashcards and quiz " +
        "questions about DIFFERENT concepts, angles or applications from the material:\n" +
        list,
    )
  }
  return lines.join("\n")
}
