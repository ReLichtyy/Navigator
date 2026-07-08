/**
 * agents/flashcard.ts — Flashcard agent. Concept→definition + cloze cards,
 * grounded in the retrieved evidence. High volume, simple task.
 */
import { z } from "zod"
import { runAgent } from "./_base"
import {
  buildDirectives,
  SUBJECT_GROUNDING_POLICY,
  type Flashcard,
  type StudyGenOptions,
} from "../study-gen"

const Schema = z.object({
  flashcards: z.array(z.object({ front: z.string(), back: z.string() })),
})

const JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    flashcards: {
      type: "array",
      description:
        "8–14 flashcards. Mix concept→definition with a few cloze (fill-in-the-blank) cards.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          front: {
            type: "string",
            description: "Concept, question, or cloze sentence with a blank",
          },
          back: { type: "string", description: "Definition / answer" },
        },
        required: ["front", "back"],
      },
    },
  },
  required: ["flashcards"],
} as const

const SYSTEM =
  "You are the flashcard agent for a university course. " +
  SUBJECT_GROUNDING_POLICY +
  " Produce study flashcards that teach the subject: mostly concept→definition, plus a few cloze " +
  "(fill-in-the-blank) cards. You may rephrase, combine and create fresh angles. Never make cards " +
  "about the document's schedule, dates or weights."

// User-preferred card style (Configuración → Formato de tarjetas). "mixed" (or
// no preference) keeps the agent's default mix from SYSTEM.
const FORMAT_HINT: Record<string, string> = {
  qa: "CARD FORMAT: the user prefers question→answer cards. Make (almost) every front a direct question.",
  cloze:
    "CARD FORMAT: the user prefers cloze cards. Make most fronts fill-in-the-blank sentences (one blank, marked with ___).",
  definition:
    "CARD FORMAT: the user prefers concept→definition cards. Make most fronts a bare concept/term and backs its definition.",
}

export async function flashcardAgent(
  evidence: string,
  opts: StudyGenOptions = {},
): Promise<Flashcard[]> {
  const formatHint = opts.cardFormat ? FORMAT_HINT[opts.cardFormat] : undefined
  const out = await runAgent({
    role: "flashcard",
    system: SYSTEM,
    user: `${buildDirectives(opts)}${formatHint ? `\n${formatHint}` : ""}\n\nCourse material:\n\n${evidence}`,
    schema: Schema,
    jsonSchema: JSON_SCHEMA as unknown as Record<string, unknown>,
    schemaName: "flashcards",
  })
  if (!out) return []
  return out.flashcards
    .map((f) => ({ front: f.front.trim(), back: f.back.trim() }))
    .filter((f) => f.front.length > 0 && f.back.length > 0)
}
