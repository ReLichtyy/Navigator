/**
 * agents/flashcard.ts — Flashcard agent. Concept→definition + cloze cards,
 * grounded in the retrieved evidence. High volume, simple task.
 */
import { z } from "zod"
import { runAgent } from "./_base"
import { buildDirectives, type Flashcard, type StudyGenOptions } from "../study-gen"

const Schema = z.object({
  flashcards: z.array(z.object({ front: z.string(), back: z.string() })),
})

const JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    flashcards: {
      type: "array",
      description: "8–14 flashcards. Mix concept→definition with a few cloze (fill-in-the-blank) cards.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          front: { type: "string", description: "Concept, question, or cloze sentence with a blank" },
          back: { type: "string", description: "Definition / answer" },
        },
        required: ["front", "back"],
      },
    },
  },
  required: ["flashcards"],
} as const

const SYSTEM =
  "You are the flashcard agent for a university course. From the supplied course material produce " +
  "study flashcards: mostly concept→definition, plus a few cloze (fill-in-the-blank) cards. Stay " +
  "grounded in the material — you may rephrase, combine and create fresh angles, but never invent " +
  "facts, dates or topics that are not present. Preserve the language of the material."

export async function flashcardAgent(
  evidence: string,
  opts: StudyGenOptions = {},
): Promise<Flashcard[]> {
  const out = await runAgent({
    role: "flashcard",
    system: SYSTEM,
    user: `${buildDirectives(opts)}\n\nCourse material:\n\n${evidence}`,
    schema: Schema,
    jsonSchema: JSON_SCHEMA as unknown as Record<string, unknown>,
    schemaName: "flashcards",
  })
  if (!out) return []
  return out.flashcards
    .map((f) => ({ front: f.front.trim(), back: f.back.trim() }))
    .filter((f) => f.front.length > 0 && f.back.length > 0)
}
