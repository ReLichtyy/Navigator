/**
 * server/rag/graph-gen.ts — extract a hierarchical topic map from syllabus text.
 *
 * Output is a 3+ level tree (level-1 main branches, cascading sub-branches),
 * a separate prerequisite DAG, and cross-branch conceptual links — plus a
 * chosen presentation layout. See graph.repo.ts for the persisted shape.
 */

import { z } from "zod"
import { ragJson, extractJson } from "@/lib/llm/rag-generate"
import { logError, logInfo, logWarn } from "@/lib/observability/logger"
import { timed } from "@/lib/observability/timing"
import type {
  GraphNodeInput,
  GraphPrereqInput,
  GraphCrossLinkInput,
  LayoutKind,
} from "../repositories/graph.repo"

const MAX_LABEL_WORDS = 4
const MAX_DETAIL_CHARS = 140

const wordCount = (s: string) => s.trim().split(/\s+/).length

/**
 * Enforces the label rule (≤4 words, no ":", no trailing "."). If the LLM
 * violates it, the label is shortened deterministically and the original
 * text is preserved in `detail` (which the UI shows on hover/expand).
 */
function normalizeNodeLabel<T extends { id: string; label: string; detail?: string | null }>(
  node: T,
): T {
  const original = node.label.trim()
  let label = original.replace(/\.+$/, "")
  if (label.includes(":")) {
    const parts = label.split(":").map((p) => p.trim())
    label = parts[parts.length - 1] || parts[0]
  }
  if (wordCount(label) > MAX_LABEL_WORDS) {
    label = label.split(/\s+/).slice(0, MAX_LABEL_WORDS).join(" ")
  }
  if (label === original) return node
  logWarn("rag.graph_gen.label_normalized", { id: node.id, original, label })
  const detail = node.detail?.trim() || original
  return { ...node, label, detail: detail.slice(0, MAX_DETAIL_CHARS) }
}

const NodeSchema = z
  .object({
    id: z.string().min(1).max(40),
    label: z.string().min(1).max(80),
    level: z.number().int().min(1).max(6),
    parentId: z.string().min(1).max(40).nullable(),
    weight: z.number().min(0).max(100).nullable().optional(),
    detail: z.string().max(140).nullable().optional(),
  })
  .transform(normalizeNodeLabel)

const CrossLinkSchema = z.object({
  source: z.string().min(1).max(40),
  target: z.string().min(1).max(40),
  label: z.string().min(1).max(60),
})

const SyllabusGraphV2Schema = z.object({
  layout: z.enum(["radial", "tree_horizontal", "tree_vertical", "columns_report"]),
  nodes: z.array(NodeSchema).min(1).max(220),
  prerequisites: z.array(z.object({ from: z.string(), to: z.string() })).max(300).default([]),
  crossLinks: z.array(CrossLinkSchema).max(60).default([]),
})

type RawNode = z.infer<typeof NodeSchema>

export interface ExtractedGraph {
  topics: GraphNodeInput[]
  prerequisites: GraphPrereqInput[]
  crossLinks: GraphCrossLinkInput[]
  layout: LayoutKind
}

const SYSTEM_PROMPT = `You are an expert at extracting hierarchical mind-maps from syllabus/course documents, following study-science structure rules. Output a single JSON object matching this shape exactly:
{"layout":"radial"|"tree_horizontal"|"tree_vertical"|"columns_report","nodes":[{"id":string,"label":string,"level":number,"parentId":string|null,"weight":number|null,"detail":string|null}],"prerequisites":[{"from":string,"to":string}],"crossLinks":[{"source":string,"target":string,"label":string}]}

STRUCTURE RULES (mandatory):

1. MINIMUM 3-LEVEL HIERARCHY:
   - Level 1: main branches (3-7 topics, never more than 7 — cognitive overload). parentId MUST be null.
   - Level 2+: cascading sub-branches. Do NOT flatten to 2 levels if the source content has real
     deeper structure (e.g. a section with subsections with specific points = 3 real levels).
   - Every node with level > 1 MUST have a non-null parentId pointing to an existing node whose
     level is exactly one less.

2. LABELS — MAX 4 WORDS, NO COLONS (strict, schema-validated — not a suggestion):
   - EVERY node's "label" is at most 4 words and must not contain ":" or end in ".".
     Correct: "API de nodos", "Eventos del DOM", "Selección de elementos".
     INCORRECT (never output these):
       "Insertar elementos en el DOM: API Nodos" (7 words, has ":")
       "Navegar a través de elementos DOM: API de inserción adyacente" (10 words)
   - If the source concept is long, SPLIT it:
       "label": the core idea in 2-4 words.
       "detail": the rest of the explanation, up to 140 characters. "detail" is NOT rendered
       inside the node box — it only appears on hover/expand — so it may be a fuller phrase.
     Any node at any level may carry "detail"; NEVER put detail content in the label.
     Example transformation:
       Source concept: "Insertar elementos en el DOM usando la API de Nodos"
       → label: "API de Nodos"
       → detail: "Insertar elementos en el DOM usando métodos como appendChild o insertBefore"
   - Before responding, re-check every generated label: if it has more than 4 words or
     contains ":", SHORTEN it yourself before returning the JSON.

3. CHOOSE ONE LAYOUT BASED ON THE CONTENT'S SHAPE (pick exactly one, do not ask):
   - "radial": content has 3-7 independent, parallel categories/ideas with no strong progression
     or hierarchy between them (e.g. "main topics of a chapter", juxtaposed concepts).
   - "tree_horizontal": content has sections with real sub-sections and depth of 3+ levels (e.g.
     an academic paper, a syllabus with modules -> topics -> subtopics).
   - "tree_vertical": content is sequential or temporal (e.g. a video, podcast, step-by-step
     process, timeline).
   - "columns_report": content is comparative or has fixed categories with a similar number of
     sub-points each (e.g. a reading report with 3 topics x 3 points each, an A/B/C comparison).

4. CROSS-BRANCH LINKS (crossLinks):
   - If two nodes from DIFFERENT branches are conceptually related, add them to "crossLinks" with
     a short relation label (e.g. "requiere", "contrasta con", "ejemplo de").
   - Do not force cross-links if no real relations exist — a map with zero crossLinks is valid.

5. WEIGHT AND SOURCE COVERAGE:
   - Assign "weight" (0-100) to level-1 nodes only, proportional to how much of the source text
     backs that branch — do not invent it. Leave weight null for level 2+ nodes.

Additionally, "prerequisites" is a SEPARATE list from the tree: {"from":id,"to":id} means "from"
must be learned before "to" (only for genuine ordering/prerequisite relationships between topics,
independent of the tree's parent/child nesting). Avoid circular prerequisites. Leave it empty if
there is no real prerequisite ordering.

Respond with the JSON object only.`

/** Drop overflow level-1 branches beyond 7 (with their whole subtree), keeping LLM's own order. */
function clampToSevenRoots(nodes: RawNode[]): RawNode[] {
  const roots = nodes.filter((n) => n.level === 1)
  if (roots.length <= 7) return nodes

  logWarn("rag.graph_gen.clamp_roots", { total: roots.length, kept: 7 })
  const keep = new Set(roots.slice(0, 7).map((n) => n.id))
  let changed = true
  while (changed) {
    changed = false
    for (const n of nodes) {
      if (keep.has(n.id)) continue
      if (n.parentId && keep.has(n.parentId)) {
        keep.add(n.id)
        changed = true
      }
    }
  }
  return nodes.filter((n) => keep.has(n.id))
}

/** Validates the parent/child tree is well-formed. Throws on the first violation. */
export function validateTree(nodes: { id: string; level: number; parentId: string | null }[]): void {
  const seen = new Set<string>()
  for (const n of nodes) {
    if (seen.has(n.id)) throw new Error(`Duplicate node id: ${n.id}`)
    seen.add(n.id)
  }
  const byId = new Map(nodes.map((n) => [n.id, n]))
  for (const n of nodes) {
    if (n.level === 1) {
      if (n.parentId !== null) throw new Error(`Level-1 node ${n.id} must have parentId null`)
      continue
    }
    if (!n.parentId) throw new Error(`Node ${n.id} (level ${n.level}) is missing parentId`)
    const parent = byId.get(n.parentId)
    if (!parent) throw new Error(`Node ${n.id} references missing parentId ${n.parentId}`)
    if (parent.level !== n.level - 1) {
      throw new Error(
        `Node ${n.id} (level ${n.level}) parent ${n.parentId} has level ${parent.level}, expected ${n.level - 1}`,
      )
    }
  }
}

/** Detects a cycle in the prerequisite DAG (independent of the tree); throws if found. */
export function validateNoCycles(nodeIds: string[], edges: { from: string; to: string }[]): void {
  const dependsOn = new Map<string, string[]>()
  for (const id of nodeIds) dependsOn.set(id, [])
  for (const e of edges) {
    if (!dependsOn.has(e.to)) continue
    dependsOn.get(e.to)!.push(e.from)
  }

  const visited = new Set<string>()
  const path = new Set<string>()
  const visit = (id: string): boolean => {
    if (path.has(id)) return false
    if (visited.has(id)) return true
    path.add(id)
    for (const dep of dependsOn.get(id) ?? []) {
      if (!visit(dep)) return false
    }
    path.delete(id)
    visited.add(id)
    return true
  }

  for (const id of nodeIds) {
    if (!visit(id)) throw new Error(`Cycle detected at node: ${id}`)
  }
}

function dedupePairs<T extends { from: string; to: string }>(pairs: T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const p of pairs) {
    const key = `${p.from}:${p.to}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(p)
  }
  return out
}

function dedupeCrossLinks(links: GraphCrossLinkInput[]): GraphCrossLinkInput[] {
  const seen = new Set<string>()
  const out: GraphCrossLinkInput[] = []
  for (const l of links) {
    const key = `${l.source}:${l.target}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(l)
  }
  return out
}

/** Extract a hierarchical topic map (tree + prerequisites + cross-links + layout) from syllabus text. */
export async function extractGraphFromText(syllabusText: string): Promise<ExtractedGraph> {
  try {
    // Cap the prompt so a large document doesn't make this call slow/costly.
    // ~15k tokens covers a syllabus' structure; the graph is an overview map.
    const { result: raw, ms } = await timed("rag.graph_gen.llm_call", () =>
      ragJson(
        SYSTEM_PROMPT,
        `Extract the hierarchical topic map from the following syllabus text:\n\n${syllabusText.slice(0, 60_000)}`,
      ),
    )
    logInfo("rag.graph_gen.llm_call", { latencyMs: ms })

    const parsed = SyllabusGraphV2Schema.parse(JSON.parse(extractJson(raw)))
    const nodes = clampToSevenRoots(parsed.nodes)
    validateTree(nodes)

    const nodeIds = new Set(nodes.map((n) => n.id))
    const prerequisites = dedupePairs(
      parsed.prerequisites.filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to) && e.from !== e.to),
    )
    validateNoCycles([...nodeIds], prerequisites)

    const crossLinks = dedupeCrossLinks(
      parsed.crossLinks.filter(
        (c) => nodeIds.has(c.source) && nodeIds.has(c.target) && c.source !== c.target,
      ),
    )

    return {
      topics: nodes.map((n) => ({
        externalId: n.id,
        label: n.label,
        level: n.level,
        parentExternalId: n.parentId,
        weight: n.weight ?? null,
        detail: n.detail ?? null,
      })),
      prerequisites,
      crossLinks,
      layout: parsed.layout,
    }
  } catch (err) {
    logError("rag.graph_gen.error", { error: err instanceof Error ? err.message : String(err) })
    throw err
  }
}
