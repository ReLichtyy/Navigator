/**
 * agents/critic.ts — the quiz/flashcard Critic (the quality gate).
 *
 * Judges each item against the source material on three axes so shallow-but-correct
 * items die too. BATCHED: one model call critiques the whole set (verdict per
 * index) instead of one call per item — same quality, a fraction of the latency
 * and tokens (the evidence is sent once, not N times). Runs (ideally) on a
 * different model family than the generator — set MODEL_VERIFIER for cross-family.
 */
import { z } from "zod"
import { runAgent } from "./_base"
import type { QuizQuestion, Flashcard } from "../study-gen"

// ── Quiz critic (batched) ────────────────────────────────────────────────────

const QuizBatchSchema = z.object({
  verdicts: z.array(
    z.object({
      index: z.number(),
      sound: z.boolean(),
      grounded: z.boolean(),
      substantive: z.boolean(),
    }),
  ),
})

const QUIZ_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    verdicts: {
      type: "array",
      description: "One verdict per question, by its index. Include EVERY index given.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          index: { type: "number", description: "The question's index as given" },
          sound: {
            type: "boolean",
            description:
              "exactly one option is correct for the subject AND the marked answer is that option",
          },
          grounded: {
            type: "boolean",
            description:
              "on-subject — the question tests a concept/definition/method/example from one of the course's " +
              "topics (the subject the material covers), NOT the document's administrative metadata (schedule, " +
              "dates, weights) and NOT an unrelated subject. Mark false for meta/document or off-topic questions.",
          },
          substantive: {
            type: "boolean",
            description:
              "tests real understanding/application of the subject, not trivia/tautology/filler",
          },
        },
        required: ["index", "sound", "grounded", "substantive"],
      },
    },
  },
  required: ["verdicts"],
} as const

const QUIZ_SYSTEM =
  "You are a strict exam-question critic. The source material is the course's topics (often only an " +
  "outline — titles, schedule, weights); a good question develops the academic SUBJECT of those topics, " +
  "it does NOT quiz the document. Given the material and a numbered list of multiple-choice questions, " +
  "judge EACH on three axes: (1) sound — exactly one option is correct for the subject and the marked " +
  "answer is that option; (2) grounded — the question is ON the course's subject (a concept/definition/" +
  "method/example from a topic the material covers) and NOT about the document's metadata (schedule, " +
  "dates, weights) nor an unrelated subject — mark false for document/meta or off-topic questions; " +
  "(3) substantive — it tests understanding/application, not trivia or filler. Be skeptical: when in " +
  "doubt on an axis, mark it false. Return one verdict per question index."

export interface QuizVerdict {
  sound: boolean
  grounded: boolean
  substantive: boolean
}

/**
 * Critique every question in one call. Returns an array aligned to `questions`
 * (index i ↔ questions[i]); an entry is null when the critic gave no verdict for
 * it (or the whole call failed) → caller keeps it (fail-open).
 */
export async function critiqueQuiz(
  questions: QuizQuestion[],
  evidence: string,
): Promise<(QuizVerdict | null)[]> {
  if (questions.length === 0) return []
  const list = questions
    .map((q, i) => {
      const opts = q.options.map((o, j) => `   ${j}. ${o}`).join("\n")
      return `#${i}\nQ: ${q.question}\n${opts}\nMarked answer index: ${q.answer}`
    })
    .join("\n\n")
  const out = await runAgent({
    role: "verifier",
    system: QUIZ_SYSTEM,
    user: `Material (evidence):\n${evidence.slice(0, 6_000)}\n\nQuestions:\n\n${list}`,
    schema: QuizBatchSchema,
    jsonSchema: QUIZ_JSON_SCHEMA as unknown as Record<string, unknown>,
    schemaName: "quiz_verdicts",
    temperature: 0,
  })
  const aligned: (QuizVerdict | null)[] = questions.map(() => null)
  if (out) {
    for (const v of out.verdicts) {
      if (v.index >= 0 && v.index < aligned.length) {
        aligned[v.index] = { sound: v.sound, grounded: v.grounded, substantive: v.substantive }
      }
    }
  }
  return aligned
}

// ── Flashcard critic (batched) ───────────────────────────────────────────────

const CardBatchSchema = z.object({
  verdicts: z.array(
    z.object({
      index: z.number(),
      accurate: z.boolean(),
      grounded: z.boolean(),
      substantive: z.boolean(),
    }),
  ),
})

const CARD_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    verdicts: {
      type: "array",
      description: "One verdict per card, by its index. Include EVERY index given.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          index: { type: "number", description: "The card's index as given" },
          accurate: {
            type: "boolean",
            description: "the back correctly defines/answers the front for the subject",
          },
          grounded: {
            type: "boolean",
            description:
              "on-subject — both sides concern the course's actual subject (a topic the material covers), not " +
              "the document's metadata (schedule, dates, weights) and not an unrelated subject",
          },
          substantive: {
            type: "boolean",
            description: "teaches something worth knowing, not trivia/tautology",
          },
        },
        required: ["index", "accurate", "grounded", "substantive"],
      },
    },
  },
  required: ["verdicts"],
} as const

const CARD_SYSTEM =
  "You are a strict flashcard critic. The source material is the course's topics (often only an outline); " +
  "a good card teaches the academic SUBJECT of those topics, it does NOT quiz the document. Given the " +
  "material and a numbered list of concept→definition (or cloze) cards, judge EACH on three axes: " +
  "(1) accurate — the back correctly defines/answers the front for the subject, no factual error; " +
  "(2) grounded — both sides concern the course's actual subject (a topic the material covers), not the " +
  "document's metadata (schedule, dates, weights) and not an unrelated subject; (3) substantive — teaches " +
  "something worth knowing, not trivia or a tautology. Be skeptical: when in doubt on an axis, mark it " +
  "false. One verdict per index."

export interface CardVerdict {
  accurate: boolean
  grounded: boolean
  substantive: boolean
}

/** Critique every flashcard in one call. Aligned to `cards`; null entry → keep. */
export async function critiqueFlashcards(
  cards: Flashcard[],
  evidence: string,
): Promise<(CardVerdict | null)[]> {
  if (cards.length === 0) return []
  const list = cards.map((c, i) => `#${i}\nFront: ${c.front}\nBack: ${c.back}`).join("\n\n")
  const out = await runAgent({
    role: "verifier",
    system: CARD_SYSTEM,
    user: `Material (evidence):\n${evidence.slice(0, 6_000)}\n\nCards:\n\n${list}`,
    schema: CardBatchSchema,
    jsonSchema: CARD_JSON_SCHEMA as unknown as Record<string, unknown>,
    schemaName: "card_verdicts",
    temperature: 0,
  })
  const aligned: (CardVerdict | null)[] = cards.map(() => null)
  if (out) {
    for (const v of out.verdicts) {
      if (v.index >= 0 && v.index < aligned.length) {
        aligned[v.index] = {
          accurate: v.accurate,
          grounded: v.grounded,
          substantive: v.substantive,
        }
      }
    }
  }
  return aligned
}
