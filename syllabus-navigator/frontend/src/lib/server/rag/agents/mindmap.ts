/**
 * agents/mindmap.ts — Mind-map agent. Produces one of four presentation modes
 * so the visual matches the content, instead of always forcing the same radial
 * fan (see `pickMindMode` in study-gen.ts for how the mode is chosen):
 *  - radial: broad overview, one branch per main topic.
 *  - profundidad: deep dive on ONE topic — that topic's own subtopics, in depth.
 *  - ideas: the material's big ideas only — terse, high-level.
 *  - bloques: a vertical block report (headers + stacked cards) for narrative/
 *    procedural material or when there's no clean topic breakdown to fan out.
 * Each mode has its own JSON schema/prompt rather than one shape reused for all.
 */
import { z } from "zod"
import { runAgent } from "./_base"
import {
  buildDirectives,
  SUBJECT_GROUNDING_POLICY,
  type StudyGenOptions,
  type Mindmap,
  type MindMode,
} from "../study-gen"

const BranchSchema = z.object({
  center: z.string(),
  branches: z.array(z.object({ label: z.string(), items: z.array(z.string()) })),
})

const BlockSchema = z.object({
  center: z.string(),
  blocks: z.array(
    z.object({
      header: z.string(),
      cards: z.array(z.object({ title: z.string(), body: z.string() })),
    }),
  ),
})

function branchJsonSchema(branchCount: string, itemsDesc: string): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      center: { type: "string", description: "Central topic/course label" },
      branches: {
        type: "array",
        description: `${branchCount} branches`,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            label: { type: "string" },
            items: { type: "array", items: { type: "string" }, description: itemsDesc },
          },
          required: ["label", "items"],
        },
      },
    },
    required: ["center", "branches"],
  }
}

const BLOCK_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    center: { type: "string", description: "Overall title for the report" },
    blocks: {
      type: "array",
      description:
        "3–6 sections, in the logical/sequential order the student should go through them",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          header: { type: "string", description: "Section title" },
          cards: {
            type: "array",
            description: "2–5 cards developing this section",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                title: { type: "string" },
                body: { type: "string", description: "1–2 sentence explanation" },
              },
              required: ["title", "body"],
            },
          },
        },
        required: ["header", "cards"],
      },
    },
  },
  required: ["center", "blocks"],
} as const

const MODE_SYSTEM: Record<MindMode, string> = {
  radial:
    "You are the mind-map agent. Produce a radial overview map of the course's main topics: a center " +
    "label and 3–5 branches (the main topics), each with 2–4 short sub-items. Cover the breadth of the " +
    "course — one branch per major topic, not per detail. " +
    SUBJECT_GROUNDING_POLICY,
  profundidad:
    "You are the mind-map agent, in DEEP-DIVE mode: the student wants to go deep on ONE topic, not see " +
    "the whole course. The center must be that topic itself. Produce 4–7 branches that are this topic's " +
    "own subtopics, each with 3–6 detailed items (definitions, mechanisms, steps, worked examples) — " +
    "real depth, not a shallow list. " +
    SUBJECT_GROUNDING_POLICY,
  ideas:
    "You are the mind-map agent, in MAIN-IDEAS mode: the student wants the big picture fast, not every " +
    "detail. The center is the material's central theme. Produce 3–5 branches, each ONE big idea stated " +
    "as a short, complete phrase; add at most 1–2 supporting items only when they truly clarify the idea " +
    "(leave items empty otherwise). Prioritize clarity and brevity over completeness. " +
    SUBJECT_GROUNDING_POLICY,
  bloques:
    "You are the mind-map agent, in BLOCK-REPORT mode: this material reads better as a sequence of " +
    "sections than as a branching tree (narrative, procedural, or with too few distinct topics to fan " +
    "out). Produce 3–6 blocks in the order the student should go through them (chronological, logical or " +
    "difficulty order), each with a short header and 2–5 cards developing it (title + 1–2 sentence body). " +
    SUBJECT_GROUNDING_POLICY,
}

const BRANCH_HINT: Record<Exclude<MindMode, "bloques">, { count: string; items: string }> = {
  radial: { count: "3–5", items: "2–4 sub-items" },
  profundidad: { count: "4–7", items: "3–6 detailed sub-items" },
  ideas: { count: "3–5", items: "0–2 short supporting items (can be empty)" },
}

export async function mindmapAgent(
  evidence: string,
  mode: MindMode,
  opts: StudyGenOptions = {},
): Promise<Mindmap | null> {
  // excludeSeen is flashcard/quiz dedupe noise — irrelevant (and distracting) here.
  const directives = buildDirectives({ ...opts, excludeSeen: undefined })
  const user = `${directives}\n\nCourse material:\n\n${evidence}`

  if (mode === "bloques") {
    const out = await runAgent({
      role: "mindmap",
      system: MODE_SYSTEM.bloques,
      user,
      schema: BlockSchema,
      jsonSchema: BLOCK_JSON_SCHEMA as unknown as Record<string, unknown>,
      schemaName: "mindmap_bloques",
      temperature: 0.4,
    })
    if (!out) return null
    const blocks = out.blocks
      .map((b) => ({
        header: b.header.trim(),
        cards: b.cards
          .map((c) => ({ title: c.title.trim(), body: c.body.trim() }))
          .filter((c) => c.title.length > 0 && c.body.length > 0),
      }))
      .filter((b) => b.header.length > 0 && b.cards.length > 0)
    if (blocks.length === 0) return null
    return { mode: "bloques", center: out.center.trim(), branches: [], blocks }
  }

  const hint = BRANCH_HINT[mode]
  const out = await runAgent({
    role: "mindmap",
    system: MODE_SYSTEM[mode],
    user,
    schema: BranchSchema,
    jsonSchema: branchJsonSchema(hint.count, hint.items),
    schemaName: "mindmap_branches",
    temperature: 0.4,
  })
  if (!out) return null
  const branches = out.branches
    .map((b) => ({ label: b.label.trim(), items: b.items.map((i) => i.trim()).filter(Boolean) }))
    .filter((b) => b.label.length > 0)
  if (branches.length === 0) return null
  return { mode, center: out.center.trim(), branches }
}
