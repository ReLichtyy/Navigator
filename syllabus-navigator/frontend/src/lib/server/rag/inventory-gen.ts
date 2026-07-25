import { z } from "zod"
import { extractJson, ragJson } from "@/lib/llm/rag-generate"
import type { SourceBlockRecord } from "../repositories/source-block.repo"

const ConceptSchema = z.object({
  id: z.string().min(1).max(60),
  label: z.string().min(1).max(100),
  parent_id: z.string().max(60).nullable().default(null),
  kind: z.enum(["topic", "definition", "example", "formula", "assessment"]),
  summary: z.string().max(400),
  importance: z.number().min(0).max(1),
  difficulty: z.number().min(0).max(1),
  source_block_ids: z.array(z.string()).min(1).max(12),
})

const InventorySchema = z.object({
  central_theme: z.string().min(1).max(160),
  learning_objectives: z.array(z.string().max(240)).max(30).default([]),
  concepts: z.array(ConceptSchema).max(180),
})

export type AcademicInventory = z.infer<typeof InventorySchema>

const SYSTEM = `Extract a grounded academic inventory. Include the central theme, learning
objectives, concepts, definitions, worked examples, formulas and assessments. Every concept must
cite one or more exact source block ids supplied in [block:<id>] markers. Never invent an id.
Return {"central_theme":string,"learning_objectives":string[],"concepts":[{"id":string,
"label":string,"parent_id":string|null,"kind":"topic"|"definition"|"example"|"formula"|
"assessment","summary":string,"importance":number,"difficulty":number,
"source_block_ids":string[]}]}.`

export function packInventoryBlocks(
  blocks: SourceBlockRecord[],
  maxChars = 24_000,
): SourceBlockRecord[][] {
  const packs: SourceBlockRecord[][] = []
  let current: SourceBlockRecord[] = []
  let size = 0
  for (const block of blocks) {
    const cost = block.content.length + 80
    if (current.length > 0 && size + cost > maxChars) {
      packs.push(current)
      current = []
      size = 0
    }
    current.push(block)
    size += cost
  }
  if (current.length > 0) packs.push(current)
  return packs
}

function renderBlocks(blocks: SourceBlockRecord[]): string {
  return blocks
    .map(
      (block) =>
        `[block:${block.id} page:${block.pageStart ?? "-"}-${block.pageEnd ?? "-"}]\n${block.content}`,
    )
    .join("\n\n")
}

async function mapPack(blocks: SourceBlockRecord[]): Promise<AcademicInventory> {
  const raw = await ragJson(
    SYSTEM,
    `Build the inventory for this source segment:\n\n${renderBlocks(blocks)}`,
  )
  const inventory = InventorySchema.parse(JSON.parse(extractJson(raw)))
  const allowed = new Set(blocks.map((block) => block.id))
  return {
    ...inventory,
    concepts: inventory.concepts.filter((concept) =>
      concept.source_block_ids.every((id) => allowed.has(id)),
    ),
  }
}

async function mapLimited<T, R>(
  values: T[],
  concurrency: number,
  fn: (value: T) => Promise<R>,
): Promise<R[]> {
  const output = new Array<R>(values.length)
  let cursor = 0
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (cursor < values.length) {
        const index = cursor++
        output[index] = await fn(values[index])
      }
    }),
  )
  return output
}

export async function generateAcademicInventory(
  blocks: SourceBlockRecord[],
): Promise<AcademicInventory> {
  if (blocks.length === 0) throw new Error("Cannot inventory an empty source")
  const partials = await mapLimited(packInventoryBlocks(blocks), 3, mapPack)
  if (partials.length === 1) return partials[0]

  const compact = partials.map((part, index) => ({ segment: index + 1, ...part }))
  const raw = await ragJson(
    SYSTEM,
    `Merge these segment inventories. Deduplicate concepts, preserve coverage and copy only the
source_block_ids already present. Do not add ids.\n\n${JSON.stringify(compact)}`,
  )
  const merged = InventorySchema.parse(JSON.parse(extractJson(raw)))
  const allowed = new Set(blocks.map((block) => block.id))
  return {
    ...merged,
    concepts: merged.concepts.filter((concept) =>
      concept.source_block_ids.every((id) => allowed.has(id)),
    ),
  }
}

export function inventoryToGroundedOutline(inventory: AcademicInventory): string {
  return [
    `Tema central: ${inventory.central_theme}`,
    ...inventory.learning_objectives.map((objective) => `Objetivo: ${objective}`),
    ...inventory.concepts.map(
      (concept) =>
        `- ${concept.label} [${concept.kind}; evidencia ${concept.source_block_ids.join(",")}]: ${concept.summary}`,
    ),
  ].join("\n")
}
